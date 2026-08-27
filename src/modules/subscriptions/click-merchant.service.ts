import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClickMerchantAuth } from './click-protocol';

/**
 * Чем закончился возврат.
 *
 * Размеченным объединением, а не `boolean`: вызывающий обязан различать «не
 * настроено» и «запрос не прошёл». Первое — ошибка развёртывания, её чинят
 * переменными окружения, и повторять такой запрос бессмысленно. Второе — сеть
 * или отказ провайдера, и это единственный случай, ради которого стоит
 * заводить строку «требует разбора» в админке.
 */
export type ClickReversalResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'not_configured' | 'invalid_payment_id' | 'request_failed';
      detail?: string;
    };

interface ClickMerchantResponse {
  error_code?: number;
  error_note?: string;
}

/**
 * Страховка на случай, если ключей `click.merchantApiUrl` /
 * `click.reversalTimeoutMs` в конфигурации не окажется.
 *
 * Сегодня они там есть, и свои умолчания `src/config/configuration.ts`
 * подставляет сам, — эти две строки на рабочей сборке не выполняются ни разу.
 * Стоят они потому, что цена промаха несимметрична: переименованный или
 * потерянный при правке ключ дал бы `undefined` в адресе (запрос к
 * «undefined/payment/reversal/…») или `undefined` в таймауте — то есть
 * `setTimeout` без задержки и мгновенный abort. И то и другое означает
 * «деньги списаны, подписка не выдана, вернуть не смогли», а узнаём мы об
 * этом от продавца. Два литерала дешевле такого разбора.
 */
const DEFAULT_MERCHANT_API_URL = 'https://api.click.uz/v2/merchant';
const DEFAULT_REVERSAL_TIMEOUT_MS = 5_000;

/**
 * Возврат уже списанного платежа через Merchant API Click.
 *
 * Единственный случай применения: Complete пришёл с `error = 0` — деньги
 * покупателя уже сняты, — а выдать подписку у нас не получилось. Оставить как
 * есть нельзя: это буквально «заплатил и не получил». Все прочие отказы
 * (Prepare, неверная подпись, чужой `service_id`) деньгами не подкреплены и
 * сюда не приходят.
 *
 * Отдельным сервисом, а не методом `SubscriptionsService`: это единственная
 * часть подписок, которая ходит наружу по сети, и держать её отдельно значит
 * иметь возможность проверить сервис подписок, не поднимая ни одного сокета.
 */
@Injectable()
export class ClickMerchantService {
  private readonly logger = new Logger(ClickMerchantService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Настроен ли возврат.
   *
   * Проверяется до похода наружу и отдельным методом: контроллер колбэка
   * обязан знать, что возврат в принципе невозможен, ещё до того, как решит,
   * каким кодом ответить провайдеру.
   *
   * Секрет тут тот же самый, что у SHOP API, — Click выдаёт один `secret_key`
   * на услугу. Не хватать для возврата может ровно одного: `merchant_user_id`,
   * идентификатора пользователя кабинета. То есть сервис, умеющий принимать
   * платежи, но не умеющий их возвращать, — это конфигурация без него.
   */
  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('click.serviceId') &&
      this.config.get<string>('click.merchantUserId') &&
      this.config.get<string>('click.secretKey'),
    );
  }

  /**
   * Вернуть платёж по номеру платёжного документа (`click_paydoc_id`).
   *
   * DELETE, а не POST: так устроен эндпоинт `/payment/reversal/{service_id}/{payment_id}`.
   *
   * Таймаут обязателен. Колбэк Click ждёт ответа считаные секунды, и зависший
   * `fetch` превратил бы отказ выдачи в молчание — после которого провайдер
   * начнёт повторять Complete, а мы на каждый повтор будем заново пытаться
   * вернуть уже возвращённое.
   *
   * Метод не бросает никогда. Он вызывается из ветки, которая сама разбирается
   * с последствиями неудачной выдачи, и исключение оттуда ушло бы к Click
   * пятисоткой вместо кода ответа протокола.
   */
  async reverse(paymentId: string): Promise<ClickReversalResult> {
    /**
     * Проверка формата до обращения наружу. `payment_id` подставляется в путь
     * запроса, а приходит он из тела колбэка — то есть снаружи. Даже с
     * `encodeURIComponent` отправлять в платёжный шлюз произвольную строку не
     * стоит: в журнале Click такой запрос выглядит как попытка что-то
     * нащупать, а ответить на него осмысленным кодом он всё равно не сможет.
     */
    if (!/^\d+$/.test(paymentId)) {
      this.logger.error(
        `Возврат Click невозможен: номер платёжного документа не число (${paymentId})`,
      );
      return { ok: false, reason: 'invalid_payment_id' };
    }

    if (!this.isConfigured()) {
      this.logger.error(
        'Возврат Click невозможен: не заданы CLICK_SERVICE_ID / CLICK_MERCHANT_USER_ID / CLICK_SECRET_KEY',
      );
      return { ok: false, reason: 'not_configured' };
    }

    const serviceId = this.config.get<string>('click.serviceId')!;
    const merchantUserId = this.config.get<string>('click.merchantUserId')!;
    /** Тот же секрет, что проверяет подписи колбэков: у Click он один на услугу. */
    const secretKey = this.config.get<string>('click.secretKey')!;
    const baseUrl = (
      this.config.get<string>('click.merchantApiUrl') ??
      DEFAULT_MERCHANT_API_URL
    ).replace(/\/+$/, '');
    const timeoutMs =
      this.config.get<number>('click.reversalTimeoutMs') ??
      DEFAULT_REVERSAL_TIMEOUT_MS;

    const timestamp = Math.floor(Date.now() / 1000);
    const auth = createClickMerchantAuth(merchantUserId, secretKey, timestamp);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `${baseUrl}/payment/reversal/${encodeURIComponent(serviceId)}/${encodeURIComponent(paymentId)}`,
        {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Auth: auth,
          },
          signal: controller.signal,
        },
      );

      /**
       * Тело читается даже при неуспешном HTTP-статусе: осмысленная причина
       * отказа лежит именно в нём (`error_note`), и без неё в журнале
       * останется голое «HTTP 400», по которому разбирать нечего.
       * `catch(() => null)` — на случай, когда вместо JSON пришла страница
       * ошибки шлюза.
       */
      const payload = (await response
        .json()
        .catch(() => null)) as ClickMerchantResponse | null;

      if (response.ok && payload?.error_code === 0) {
        this.logger.warn(`Платёж Click ${paymentId} возвращён покупателю`);
        return { ok: true };
      }

      const detail = payload?.error_note ?? `HTTP ${response.status}`;
      this.logger.error(
        `Возврат платежа Click ${paymentId} отклонён: ${detail}`,
      );
      return { ok: false, reason: 'request_failed', detail };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Возврат платежа Click ${paymentId} не прошёл: ${detail}`,
      );
      return { ok: false, reason: 'request_failed', detail };
    } finally {
      clearTimeout(timeout);
    }
  }
}
