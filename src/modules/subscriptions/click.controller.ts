import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ClickMerchantService } from './click-merchant.service';
import {
  CLICK_RESPONSE,
  clickField,
  parseClickCallback,
  verifyClickSignature,
} from './click-protocol';
import {
  SubscriptionsService,
  type CompleteResult,
} from './subscriptions.service';

/**
 * Ответ провайдеру. Ключи — в snake_case, потому что это не наш формат: их
 * читает робот Click и сверяет по именам из документации. Оба идентификатора
 * возвращаются всегда, даже в отказе: по ним провайдер сопоставляет ответ со
 * своим запросом, а `merchant_prepare_id` / `merchant_confirm_id` появляются
 * только там, где счёт действительно есть.
 */
interface ClickAnswer {
  click_trans_id: string;
  merchant_trans_id: string;
  merchant_prepare_id?: number;
  merchant_confirm_id?: number;
  error: number;
  error_note: string;
}

/** Пара «код + текст» из таблицы протокола. */
type ClickResponseCode = (typeof CLICK_RESPONSE)[keyof typeof CLICK_RESPONSE];

/**
 * Реквизиты, добытые по ходу разбора.
 *
 * Существует ради ветки отказа: она вызывается в том числе из `catch`, где
 * локальных переменных обработчика уже нет, а записать строку «деньги списаны,
 * подписку не выдали» нужно с магазином и суммой. Пустой магазин — законное
 * состояние: `merchant_trans_id` мог не разрешиться вовсе, и
 * `recordFailedComplete` это предусматривает.
 */
interface CallbackContext {
  shopId: number | null;
  amount: number;
  /**
   * Сошлась ли подпись и наша ли это услуга.
   *
   * Ветка возврата смотрит на этот флаг прежде всего остального. Возврат —
   * действие, которое видно у провайдера и которое отменяет чужую оплату; если
   * запустить его до сверки подписи, любой желающий отменял бы платежи наших
   * покупателей запросом `action=1&error=0&click_paydoc_id=<чужой номер>`.
   * Merchant API работает в границах нашей услуги, поэтому мишенью были бы
   * ровно наши продавцы.
   */
  trusted: boolean;
}

/**
 * Сколько тела попадает в журнал. Тело приходит снаружи, и в нём может
 * оказаться сколь угодно длинное поле: без ограничения один запрос выдавил бы
 * из логов всё остальное ровно в тот момент, когда по ним разбирают платёж.
 */
const LOG_BODY_LIMIT = 1000;

/**
 * Нормальный код отказа Complete — тот, которым отвечают, когда деньги ещё не
 * тронуты (Complete с отрицательным `error`: провайдер сообщает об отмене, а
 * не о списании). Когда деньги списаны, ответ другой и считается в
 * `failComplete`.
 */
const COMPLETE_FAILURE_CODE: Record<
  'not_found' | 'invalid_amount' | 'mismatch' | 'shop_gone',
  ClickResponseCode
> = {
  not_found: CLICK_RESPONSE.transactionNotFound,
  invalid_amount: CLICK_RESPONSE.invalidAmount,
  mismatch: CLICK_RESPONSE.invalidRequest,
  shop_gone: CLICK_RESPONSE.invalidRequest,
};

/** Причина отказа человеческими словами — уходит в журнал и в `meta.errorNote`. */
const COMPLETE_FAILURE_NOTE: Record<
  'not_found' | 'invalid_amount' | 'mismatch' | 'shop_gone',
  string
> = {
  not_found: 'Complete по транзакции, которой нет в журнале платежей',
  invalid_amount: 'Сумма Complete не совпала с суммой принятого Prepare',
  mismatch: 'Реквизиты Complete не сошлись с сохранённым Prepare',
  shop_gone: 'Магазин перестал быть активным между Prepare и Complete',
};

/**
 * Тело запроса для журнала — без `sign_string`.
 *
 * Подпись выброшена намеренно: это md5 от строки, в середине которой стоит
 * `CLICK_SECRET_KEY`, а все остальные слагаемые лежат рядом в том же логе.
 * Вместе они дают готовый материал для офлайнового подбора секрета, и цена
 * такой находки — возможность подписывать колбэки от нашего имени. Всё
 * остальное сохраняется как есть: разбирать платёж по обрезанному телу нечем.
 */
function bodyForLog(body: Record<string, unknown>): string {
  const safe: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(body)) {
    if (key === 'sign_string') continue;
    safe[key] = raw;
  }
  return JSON.stringify(safe).slice(0, LOG_BODY_LIMIT);
}

/**
 * Сумма из тела до строгого разбора.
 *
 * Нужна затем, чтобы строка об отказе не осталась без суммы, если исключение
 * случилось раньше, чем `parseClickCallback` успел отработать. Ноль означает
 * «сумму прочитать не удалось» — с ним `recordFailedComplete` не заведёт новую
 * строку (в журнале платежей сумма строго положительна), но найдёт и пометит
 * существующую, а это главное.
 */
function looseAmount(body: Record<string, unknown>): number {
  const parsed = Number(clickField(body, 'amount'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Списаны ли по этому запросу деньги.
 *
 * Complete с нулевым `error` — единственное состояние протокола, в котором
 * покупатель уже заплатил. Отсюда и правило B3: любой наш отказ в этот момент
 * обязан закончиться возвратом, а не просто кодом ответа.
 *
 * Отсутствующее поле `error` считается нулём (`Number('')` === 0), и это
 * сделано осознанно. Ошибиться можно в две стороны, и они несимметричны:
 * лишний возврат по неоплаченной транзакции провайдер отклонит, мы ответим
 * `-7` и запишем строку в разбор — шум; пропущенный возврат по оплаченной
 * означает деньги, оставшиеся у нас без подписки, и узнаём мы об этом от
 * продавца. Поэтому при сомнении считаем, что деньги списаны.
 */
function isPaidComplete(body: Record<string, unknown>): boolean {
  return (
    clickField(body, 'action') === '1' &&
    Number(clickField(body, 'error')) === 0
  );
}

/**
 * Колбэк Click (SHOP API) — приём оплаты подписки магазина.
 *
 * Самое дорогое место сервиса: здесь и только здесь деньги покупателя
 * превращаются в подписку, и любая ошибка стоит либо потерянной оплаты, либо
 * выданного даром периода. Отсюда четыре решения, которые выглядят странно и
 * менять которые нельзя.
 *
 * **1. Тело — `Record<string, unknown>`, а не DTO.** Глобальный
 * `ValidationPipe` поднят с `forbidNonWhitelisted: true`, а Click присылает
 * поля, которых нет в документации (`merchant_user_id`, `error_note`, изредка
 * новые). С DTO любое такое поле превратилось бы в 400 — то есть в сорванный
 * платёж на каждом обновлении у провайдера. `ValidationPipe.toValidate`
 * пропускает параметры, отражённые как `String | Boolean | Number | Array |
 * Object`, а `Record<string, unknown>` отражается именно как `Object`.
 * Проверку формата делает `parseClickCallback` — строже, чем это сделал бы
 * валидатор, и с кодами ответа протокола вместо HTTP-ошибки.
 *
 * **2. Разбор form-urlencoded включать не нужно.**
 * `@nestjs/platform-express` сам регистрирует `express.urlencoded({ extended:
 * true })` в `registerParserMiddleware`
 * (`node_modules/@nestjs/platform-express/adapters/express-adapter.js:188-196`),
 * и `req.body` приезжает плоским объектом строк. JSON, если он однажды придёт,
 * разберётся там же — обработчику всё равно.
 *
 * **3. `@SkipThrottle()` обязателен.** Прецедент в репозитории тот же по
 * природе — вебхук Telegram (`bot.controller.ts:29`). Провайдер повторяет
 * запросы пачками, а 429 в ответ на Complete означает потерянную оплату при
 * уже списанных деньгах. `@Public()` снимает `JwtAuthGuard`; ролевого
 * декоратора нет вовсе, поэтому `RolesGuard` пропускает.
 *
 * **4. Обработчик не имеет права бросать.** Исключение ушло бы через
 * `I18nExceptionFilter` в JSON `{statusCode, message}`, которого Click не
 * понимает, — и он повторил бы запрос, а мы повторили бы отказ. Поэтому весь
 * метод обёрнут в один `try/catch`, наружу всегда HTTP 200 и тело
 * `{ error, error_note }`.
 *
 * **5. Отказ по оплаченному Complete всегда кончается возвратом (B3).** Ветка
 * `failComplete` не привязана к какому-то одному виду отказа: она срабатывает
 * везде, где мы говорим «нет» запросу, по которому деньги уже списаны, — от
 * неразобранного тела до неразрешившегося магазина и исключения из базы.
 * Единственные исключения — `already_paid` и `cancelled`: это законные
 * повторы, и возвращать по ним платёж значило бы отменять его на каждом
 * повторном колбэке. Порог у ветки один и жёсткий — `owesRefund`.
 *
 * Из Swagger контроллер исключён намеренно: тело — form-urlencoded без схемы,
 * а сгенерированный orval'ом хук на такую ручку клиенту не нужен и только
 * засорял бы `lib/api/generated`.
 */
/**
 * Пути, на которых колбэк принимается. Их несколько по той же причине, что и в
 * рабочем образце (save-up слушает `/rpc/click/callback`, `/api/click/callback`
 * и `/click/callback`): адрес колбэка живёт не в коде, а в кабинете Click, и
 * поправить его там может не тот, кто писал код. Промах на один сегмент даёт
 * 404, а Click показывает плательщику «Оплата временно невозможна.
 * Недостаточно информации от поставщика» — сообщение, по которому невозможно
 * догадаться, что дело в адресе.
 *
 * Лишние пути ничего не стоят: обработчик один, гварды одни, а вся проверка
 * начинается с подписи — на любой из них неподписанный запрос уйдёт с `-1`.
 *
 * Глобальный префикс `api/v1` добавляется к обоим (см. `main.ts`), так что
 * наружу это `/api/v1/subscriptions/click/callback` и `/api/v1/click/callback`.
 */
const CALLBACK_ROUTES = ['subscriptions/click', 'click'];

@ApiExcludeController()
@Controller(CALLBACK_ROUTES)
export class ClickController {
  private readonly logger = new Logger(ClickController.name);

  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly merchant: ClickMerchantService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Все три пути ведут в один обработчик.
   *
   * `callback` — наш основной: обе стадии различаются полем `action`, как и
   * описано в SHOP API. `prepare` и `complete` добавлены потому, что кабинет
   * Click позволяет задать стадии РАЗНЫМИ адресами, и в рабочих интеграциях их
   * так и задают. Какой адрес прописан у поставщика, снаружи не видно, а
   * промах означает 404 и сообщение «Недостаточно информации от поставщика» у
   * плательщика — при полностью исправном коде.
   *
   * Стадию по-прежнему определяет `action`, а не путь: доверять адресу больше,
   * чем телу, значило бы завести второй источник правды о том, что происходит
   * с деньгами.
   */
  @Public()
  @SkipThrottle()
  @Post(['callback', 'prepare', 'complete'])
  @HttpCode(HttpStatus.OK)
  async handle(@Body() body: Record<string, unknown>): Promise<ClickAnswer> {
    const context: CallbackContext = {
      shopId: null,
      amount: looseAmount(body),
      trusted: false,
    };

    /**
     * Входящий колбэк пишется в журнал ДО разбора и всегда.
     *
     * Без этой строки отказ выглядит одинаково при трёх совершенно разных
     * причинах: провайдер до нас не дошёл, дошёл и получил отказ, дошёл с
     * телом не той формы. Разбирать их по жалобе плательщика невозможно, а
     * повторить платёж, чтобы посмотреть, — стоит денег. Перечень ключей тела
     * здесь важнее значений: именно он показывает, что `merchant_trans_id`
     * приехал пустым, а значение лежит в `transaction_param`.
     */
    this.logger.log(`Колбэк Click: ${bodyForLog(body)}`);

    try {
      return await this.dispatch(body, context);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Колбэк Click сорвался: ${detail} | ${bodyForLog(body)}`,
        error instanceof Error ? error.stack : undefined,
      );

      /**
       * Отказ без списания стоит одного кода ответа: Prepare провайдер
       * повторит, а деньги на этой стадии ещё у покупателя. Единственный
       * случай, требующий большего, — сорванный Complete по оплаченной
       * транзакции.
       */
      if (!this.owesRefund(body, context)) {
        return answer(body, CLICK_RESPONSE.invalidRequest);
      }

      return this.failComplete(
        body,
        context,
        `Исключение при обработке Complete: ${detail}`,
      );
    }
  }

  /**
   * Должны ли мы вернуть деньги, отказав по этому запросу (B3).
   *
   * Два условия, и оба обязательны. Деньги списаны — иначе возвращать нечего
   * (`isPaidComplete`). Запрос действительно от Click и по нашей услуге —
   * иначе возврат превращается в оружие против наших же продавцов
   * (`context.trusted`, разбор там же).
   */
  private owesRefund(
    body: Record<string, unknown>,
    context: CallbackContext,
  ): boolean {
    return context.trusted && isPaidComplete(body);
  }

  /**
   * Разбор и выдача. Порядок проверок взят из документации Click и менять его
   * нельзя: каждая следующая опирается на то, что предыдущая уже отсеяла.
   */
  private async dispatch(
    body: Record<string, unknown>,
    context: CallbackContext,
  ): Promise<ClickAnswer> {
    /**
     * Подпись — первой, до всего остального. Неподписанному запросу нельзя
     * отвечать даже «такого магазина нет»: это уже ответ, по которому чужой
     * перебирает telegram-id наших продавцов.
     */
    const secretKey = this.config.get<string>('click.secretKey');
    if (!secretKey) {
      this.logger.error(
        'Колбэк Click отклонён: CLICK_SECRET_KEY не задан — проверить подпись нечем',
      );
      return answer(body, CLICK_RESPONSE.signFailed);
    }
    if (!verifyClickSignature(body, secretKey)) {
      this.logger.warn(`Колбэк Click с неверной подписью: ${bodyForLog(body)}`);
      return answer(body, CLICK_RESPONSE.signFailed);
    }

    /**
     * Стадия — раньше всех прочих полей: у протокола ровно две, и на третью
     * у него нет ни ответа, ни смысла. `parseClickCallback` проверил бы это
     * тоже, но вернул бы общий `null`, из которого код `-3` уже не вывести.
     */
    const action = clickField(body, 'action');
    if (action !== '0' && action !== '1') {
      this.logger.warn(`Колбэк Click с чужой стадией: ${bodyForLog(body)}`);
      return answer(body, CLICK_RESPONSE.actionNotFound);
    }

    /**
     * Услуга — до разбора и до базы. Подпись сошлась, значит запрос от Click,
     * но прийти он мог по другой услуге того же кабинета: принимать за неё
     * оплату мы не вправе.
     */
    const serviceId = this.config.get<string>('click.serviceId');
    if (!serviceId || clickField(body, 'service_id') !== serviceId) {
      this.logger.error(
        `Колбэк Click по чужой услуге (ожидалась ${serviceId ?? 'не задана'}): ${bodyForLog(body)}`,
      );
      /**
       * Возврата здесь нет и быть не может: платёж по чужой услуге — не наш,
       * и Merchant API, работающий в границах нашего `service_id`, отменить
       * его всё равно не сможет. Отвечаем отказом и оставляем разбираться
       * тому, чья это услуга.
       */
      return answer(body, CLICK_RESPONSE.invalidRequest);
    }

    /**
     * С этой строки запрос считается подлинным: подпись сошлась, услуга наша.
     * Только теперь ветке отказа позволено трогать деньги.
     */
    context.trusted = true;

    const callback = parseClickCallback(body);
    if (!callback) {
      /**
       * Разбор не говорит, что именно не сошлось, — да и кодов на каждую
       * разновидность мусора в протоколе нет. Отдельного ответа заслуживает
       * только сумма: `-2` провайдер показывает покупателю осмысленно, а `-8`
       * читается как «у нас что-то сломалось».
       */
      const amountText = clickField(body, 'amount');
      const amountBroken =
        !/^\d+(?:\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0;
      this.logger.warn(`Колбэк Click не разобран: ${bodyForLog(body)}`);

      /**
       * Подписанный Complete с нулевым `error`, который мы не смогли разобрать,
       * — это всё равно списанные деньги. Формат нам не по зубам, но вернуть
       * платёж по `click_paydoc_id` мы обязаны попробовать: ответ `-2` или
       * `-8` оставил бы деньги у нас, а повторы колбэка бесконечно упирались
       * бы в ту же ошибку разбора.
       */
      if (this.owesRefund(body, context)) {
        return this.failComplete(
          body,
          context,
          'Complete с нулевым error не разобран по формату протокола',
        );
      }

      return answer(
        body,
        amountBroken
          ? CLICK_RESPONSE.invalidAmount
          : CLICK_RESPONSE.invalidRequest,
      );
    }

    context.amount = callback.amount;

    /**
     * Положительный код — сообщение об ошибке на стороне провайдера, а не
     * запрос на действие. Ни принимать по нему счёт, ни выдавать подписку
     * нельзя; отрицательный разбирается дальше по стадиям, потому что там
     * поведение различается.
     */
    if (callback.clickError > 0) {
      this.logger.warn(
        `Колбэк Click с ошибкой провайдера ${callback.clickError}: ${bodyForLog(body)}`,
      );
      return answer(body, CLICK_RESPONSE.invalidRequest);
    }

    const shop = await this.subscriptions.findShopForPayment(
      callback.merchantTransId,
    );
    if (!shop) {
      this.logger.warn(
        `Колбэк Click по неизвестному плательщику: merchant_trans_id=${callback.merchantTransId}, ` +
          `click_trans_id=${callback.clickTransId}`,
      );

      /**
       * На Prepare это дешёвый отказ: `-5` уходит до списания, и Click просто
       * не проведёт платёж. На Complete — дыра, ради которой существует B3.
       * `findShopForPayment` фильтрует `status = 'active'`, поэтому магазин,
       * упразднённый между стадиями, перестаёт находиться здесь, а до
       * `complete()` с его веткой `shop_gone` дело уже не доходит: деньги
       * списаны, подписки нет, и ответить одним `-5` значило бы потерять их
       * молча.
       */
      if (this.owesRefund(body, context)) {
        return this.failComplete(
          body,
          context,
          `Плательщик Complete не разрешился в магазин (merchant_trans_id=${callback.merchantTransId})`,
        );
      }

      return answer(body, CLICK_RESPONSE.userNotFound);
    }
    context.shopId = shop.id;

    if (callback.action === 0) {
      return this.prepare(body, callback, shop.id);
    }
    return this.complete(body, callback, context, shop.id);
  }

  /**
   * Prepare — «примем ли мы такой счёт». Денег на этой стадии никто не трогал,
   * поэтому любой отказ стоит ровно одного кода ответа: возвращать нечего.
   *
   * Исключения здесь намеренно не ловятся отдельно. Единственное, которое
   * бросает `prepare()`, — конфликт по номеру платёжного документа (V1: одно
   * списание пришло под двумя `click_trans_id`), и он должен закончиться
   * отказом `-8` до всякой выдачи. Общий `catch` обработчика делает ровно это:
   * `owesRefund` на стадии 0 ложно, ответ — `invalidRequest`. Сам конфликт уже
   * описан в журнале самим `prepare()`.
   */
  private async prepare(
    body: Record<string, unknown>,
    callback: NonNullable<ReturnType<typeof parseClickCallback>>,
    shopId: number,
  ): Promise<ClickAnswer> {
    /**
     * Отрицательный код на Prepare — отмена ещё не начавшегося платежа.
     * Заводить под неё строку незачем: счёта не существует, отменять нечего.
     */
    if (callback.clickError < 0) {
      return answer(body, CLICK_RESPONSE.cancelled);
    }

    /**
     * За что заплатили — определяется по сумме: Click сообщает, сколько
     * заплатили, но не за что. Кроме прайса есть символическая сумма проверки
     * кассы, и принимается она, только пока администратор держит окно открытым
     * на этот магазин; весь разбор — внутри `resolvePurchase`.
     *
     * Сумма, не подошедшая ни подо что, означает, что покупать было нечего.
     * Отказ здесь бесплатен: на Prepare деньги ещё у покупателя.
     */
    const purchase = await this.subscriptions.resolvePurchase(
      shopId,
      callback.amount,
    );
    if (!purchase) {
      this.logger.warn(
        `Prepare Click с суммой мимо прайса: ${callback.amount}, магазин ${shopId}, ` +
          `click_trans_id=${callback.clickTransId}`,
      );
      return answer(body, CLICK_RESPONSE.invalidAmount);
    }

    if (purchase.kind === 'test') {
      this.logger.warn(
        `Prepare Click тестовой суммой ${callback.amount}: магазин ${shopId}, ` +
          `click_trans_id=${callback.clickTransId}. Подписка выдаваться не будет`,
      );
    }

    const result = await this.subscriptions.prepare({
      shopId,
      plan: purchase.kind === 'plan' ? purchase.plan : null,
      amount: callback.amount,
      providerTransactionId: callback.clickTransId,
      providerPaymentId: callback.clickPaydocId,
      serviceId: callback.serviceId,
      signTime: callback.signTime,
    });

    switch (result.kind) {
      case 'prepared':
        return answer(body, CLICK_RESPONSE.success, {
          merchant_prepare_id: result.payment.merchantBillingId,
        });
      case 'already_paid':
        return answer(body, CLICK_RESPONSE.alreadyPaid);
      case 'cancelled':
        return answer(body, CLICK_RESPONSE.cancelled);
      case 'conflict':
        return answer(body, CLICK_RESPONSE.invalidRequest);
    }
  }

  /**
   * Complete — «деньги списаны, выдавайте».
   *
   * Отказы делятся надвое, и деление проходит не по виду отказа, а по тому,
   * тронуты ли деньги. `already_paid` и `cancelled` — законные повторы:
   * провайдер переспрашивает про транзакцию, с которой мы уже всё решили, и
   * отвечать на них возвратом значило бы возвращать платёж на каждом повторе
   * колбэка. Всё остальное при нулевом `error` — «деньги у нас, подписки
   * нет», и это ветка `failComplete` (B3).
   */
  private async complete(
    body: Record<string, unknown>,
    callback: NonNullable<ReturnType<typeof parseClickCallback>>,
    context: CallbackContext,
    shopId: number,
  ): Promise<ClickAnswer> {
    const result: CompleteResult = await this.subscriptions.complete({
      shopId,
      providerTransactionId: callback.clickTransId,
      providerPaymentId: callback.clickPaydocId,
      merchantPrepareId: callback.merchantPrepareId,
      amount: callback.amount,
      clickError: callback.clickError,
      errorNote: clickField(body, 'error_note') || undefined,
      signTime: callback.signTime,
    });

    switch (result.kind) {
      case 'paid':
        return answer(body, CLICK_RESPONSE.success, {
          merchant_confirm_id: result.payment.merchantBillingId,
        });
      case 'already_paid':
        return answer(body, CLICK_RESPONSE.alreadyPaid);
      case 'cancelled':
        return answer(body, CLICK_RESPONSE.cancelled);
      default:
        break;
    }

    /**
     * Complete с отрицательным `error` — уведомление об отмене, деньги по нему
     * не списывались. Отвечаем нормальным кодом отказа и ничего не возвращаем:
     * возврат несписанного платежа провайдер отклонит, а строка «требует
     * разбора» появилась бы на пустом месте.
     */
    if (!this.owesRefund(body, context)) {
      return answer(body, COMPLETE_FAILURE_CODE[result.kind]);
    }

    return this.failComplete(body, context, COMPLETE_FAILURE_NOTE[result.kind]);
  }

  /**
   * Деньги списаны, подписку выдать не удалось (B3).
   *
   * Три действия, и все три обязательны. Журнал — потому что разбирать
   * обращение «списали и ничего не дали» больше будет не по чему: тело
   * колбэка нигде не хранится. Возврат — потому что оставить деньги у себя
   * нельзя ни при каком объяснении. Строка в `subscription_payments` — потому
   * что журнал приложения живёт неделями, а обращение приходит месяцами позже,
   * и в админке должно быть видно, чем всё кончилось.
   *
   * Формат `click_paydoc_id` проверяет сам `ClickMerchantService.reverse` — до
   * обращения наружу и с отдельной причиной отказа `invalid_payment_id`:
   * номер подставляется в путь запроса к платёжному шлюзу, а приходит он
   * снаружи.
   *
   * Код ответа определяется исходом возврата, а не видом отказа. `-9` после
   * удавшегося возврата — правда с точки зрения провайдера: транзакции больше
   * нет. `-7` — честное «у нас не получилось», после которого Click повторит
   * Complete; повтор наткнётся на ту же ошибку и попробует вернуть деньги
   * снова, а это ровно то, чего мы хотим, пока возврат не пройдёт.
   */
  private async failComplete(
    body: Record<string, unknown>,
    context: CallbackContext,
    note: string,
  ): Promise<ClickAnswer> {
    const providerTransactionId = clickField(body, 'click_trans_id');
    const providerPaymentId = clickField(body, 'click_paydoc_id');

    this.logger.error(
      `Деньги списаны, подписка не выдана: ${note} | ${bodyForLog(body)}`,
    );

    const reversal = await this.merchant.reverse(providerPaymentId);

    await this.subscriptions.recordFailedComplete({
      shopId: context.shopId,
      providerTransactionId,
      providerPaymentId,
      amount: context.amount,
      clickError: Number(clickField(body, 'error')) || 0,
      errorNote: note,
      reversed: reversal.ok,
      reversalNote: reversal.ok
        ? undefined
        : `${reversal.reason}${reversal.detail ? `: ${reversal.detail}` : ''}`,
    });

    if (!reversal.ok) {
      this.logger.error(
        `Вернуть платёж Click не удалось (${reversal.reason}): click_trans_id=${providerTransactionId}, ` +
          `click_paydoc_id=${providerPaymentId}, магазин ${context.shopId ?? 'не определён'}. ` +
          'Строка помечена как требующая разбора — деньги возвращает человек',
      );
    }

    return answer(
      body,
      reversal.ok ? CLICK_RESPONSE.cancelled : CLICK_RESPONSE.updateFailed,
    );
  }
}

/**
 * Ответ провайдеру.
 *
 * Идентификаторы читаются тем же `clickField`, что и при разборе: два разных
 * способа прочитать одно поле однажды прочитали бы его по-разному, и в ответе
 * оказался бы не тот `click_trans_id`, по которому Click ищет свою запись.
 */
function answer(
  body: Record<string, unknown>,
  response: ClickResponseCode,
  extra?: Pick<ClickAnswer, 'merchant_prepare_id' | 'merchant_confirm_id'>,
): ClickAnswer {
  return {
    click_trans_id: clickField(body, 'click_trans_id'),
    merchant_trans_id: clickField(body, 'merchant_trans_id'),
    ...extra,
    error: response.error,
    error_note: response.note,
  };
}
