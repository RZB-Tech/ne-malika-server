import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { OPENROUTER_CLIENT } from '../openrouter/openrouter-client.provider';
import { describeError, usageCost } from '../openrouter/openrouter.util';
import { FilesService } from '../files/files.service';
import { CategoriesService } from '../categories/categories.service';
import { ShopsService } from '../shops/shops.service';
import { CreditsService, type AutofillHold } from '../credits/credits.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { AUTOFILL_CREDITS } from '../credits/credits.constants';
import { AUTOFILL_FREE_PER_MONTH } from '../subscriptions/subscriptions.constants';
import type { CategoryDto } from '../categories/dto/category.dto';
import {
  AUTOFILL_MAX_PHOTOS,
  AutofillPriceDto,
  AutofillProductDto,
  AutofilledProductDto,
} from './dto/product-autofill.dto';
import {
  parseAutofillResult,
  type AutofillCategory,
  type AutofillResult,
} from './product-autofill.types';

/** Автор запроса. Администратор ходит к модели за счёт площадки. */
interface Author {
  id: number;
  isAdmin: boolean;
}

/**
 * Чем обернулось автозаполнение для отчётности: чей это магазин, было ли оно
 * бесплатным и сколько бесплатных попыток осталось.
 *
 * Одной функцией на всех потребителей — ответ формы и строку `ai_usage` — и
 * это главное в ней. Три поля выводятся из одного и того же резерва, живут в
 * разных местах кода и разъезжаются легко: достаточно посчитать `free` в
 * журнале иначе, чем в ответе, и разбор жалобы «списали, хотя было бесплатно»
 * упрётся в два несогласных источника.
 *
 * `platform` (администратор) — `free: false`, и это не описка. Признак отвечает
 * на вопрос «магазину досталось даром», а магазина у администратора нет: его
 * строка отличается пустым `shop_id`, как и написано в докблоке колонки
 * `ai_usage.free`. Сделав здесь `true`, мы смешали бы в отчётах расход на
 * подписчиков с расходом на собственные проверки площадки.
 */
export function autofillOutcome(hold: AutofillHold): {
  shopId: number | null;
  free: boolean;
  freeLeft: number | null;
} {
  switch (hold.kind) {
    case 'platform':
      return { shopId: null, free: false, freeLeft: null };
    case 'unlimited':
      return { shopId: hold.shopId, free: true, freeLeft: null };
    case 'free':
      return { shopId: hold.shopId, free: true, freeLeft: hold.leftAfter };
    case 'paid':
      return { shopId: hold.hold.shopId, free: false, freeLeft: null };
  }
}

/**
 * Ответ длиннее, чем у правки описания: описание и десяток характеристик за
 * один раз, да ещё по трём фотографиям.
 */
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_COMPLETION_TOKENS = 1600;

/**
 * Повтор ровно один.
 *
 * Резерв кредитов уже занят, а продавец смотрит на крутящийся спиннер: три
 * подхода по полторы минуты он ждать не станет и нажмёт кнопку снова, заняв
 * второй резерв под ту же карточку.
 */
const MAX_RETRIES = 1;

/**
 * Сколько разделов каталога перечислять в промпте.
 *
 * Каталог наполняется вручную и двумя уровнями, так что в потолок он упрётся не
 * скоро. Но список идёт в каждый запрос, и без предела разросшийся каталог
 * однажды съел бы бюджет промпта молча — с обрезкой это хотя бы видно в логе.
 */
const MAX_PROMPT_CATEGORIES = 200;

/**
 * Задание модели.
 *
 * По-русски, как и правка описания, и по той же причине: модель здесь не
 * рисует, а пишет для покупателя, и примеры формулировок должны быть на языке
 * результата.
 *
 * Половина текста — про запрет выдумывать. Это не перестраховка: продавец
 * нажимает кнопку ради экономии времени и подставленное отправляет почти не
 * вычитывая. Приписанные «16 ГБ» уедут в карточку, оттуда — в обещание
 * покупателю, а разбираться с обманом придётся продавцу, который его не давал.
 */
const AUTOFILL_SYSTEM = `Ты товаровед маркетплейса компьютерной техники. По фотографиям товара и его названию ты заполняешь карточку за продавца: пишешь описание и собираешь характеристики.

Верни строго JSON и ничего больше — без пояснений, без блока кода:
{"description":"...","characteristics":[{"key":"...","value":"..."}],"brand":"...","model":"...","categoryId":12,"state":"new"}

ГЛАВНОЕ ПРАВИЛО — не выдумывать. В карточку идёт только то, что видно на фотографии, напечатано на корпусе, коробке или наклейке, либо сказано продавцом в названии и его тексте. Чего не знаешь — не пиши вовсе: короткая честная карточка лучше полной придуманной. Продавец подставит твой текст почти не вычитывая, и приписанные «16 ГБ», «частота 3200 МГц» или «гарантия 2 года» станут его обещанием покупателю, которого он не давал.

description — готовое описание для витрины:
- одно-два предложения о товаре, пустая строка, затем 3–5 пунктов списка с тем, что действительно известно;
- разметка только такая: абзацы через пустую строку, пункты через «- » в начале строки, **жирным** название параметра внутри пункта («- **Подсветка:** RGB»). Без заголовков (#), таблиц, ссылок, картинок, цитат и блоков кода — витрина их не покажет;
- до 700 символов вместе с разметкой. Фактов мало — пиши короче и без списка;
- если продавец уже что-то написал, сохрани все его факты: модель, состояние, комплектацию, гарантию, количество. Исправь орфографию, грамматику, пунктуацию и КАПС, но не спорь с ним и не выбрасывай сказанное;
- без телефонов, ссылок, ников в Telegram, цены и призывов «пишите в директ»: для связи на сайте есть своя кнопка, а такие объявления снимает модерация;
- без эмодзи и рекламных восклицаний.

characteristics — от 3 до 10 пар «параметр — значение»:
- key — короткое название параметра («Процессор», «Объём памяти», «Разъёмы»), value — само значение («Apple M2», «8 ГБ», «USB-C, HDMI»);
- сначала то, что покупатель ищет глазами: тип и назначение, ключевые узлы, объёмы, интерфейсы, цвет, комплектация в кадре;
- характеристики продавца сохрани и приведи к тому же виду, свои добавляй после них;
- бренд и модель сюда не пиши — для них есть отдельные поля;
- цену, состояние, гарантию, доставку и контакты сюда не пиши: это не характеристики товара, а отдельные поля карточки и запрещённые сведения.

brand и model — производитель и модель, если их видно на фото или продавец назвал их сам. По форме корпуса не угадывай: нет уверенности — null.

categoryId — раздел каталога из списка в конце запроса, ближе всего подходящий товару. Ничего не подходит — null. Идентификаторы не придумывай: только те, что в списке.

state — «new», если товар явно новый: запечатанная коробка, нетронутая плёнка, идеальный корпус без следов эксплуатации или прямые слова продавца. «old», если видны потёртости, царапины, пыль, отсутствие упаковки при явном использовании или продавец назвал товар б/у. Не понять — null; лучше null, чем догадка.

Язык описания и характеристик — тот, на котором писал продавец: русский, узбекская латиница или узбекская кириллица. Своего текста у продавца не было — пиши по-русски.`;

/**
 * Добавка для раздела услуг. Там продаётся работа, а не вещь: требовать от
 * такой карточки разъёмы и объём памяти бессмысленно, а «состояние: б/у» у
 * ремонта — просто ошибка.
 */
const SERVICE_NOTE = `Это карточка УСЛУГИ — продаётся работа мастера, а не вещь. Заполняй иначе:
- description — что именно делает мастер, что входит в работу, сколько занимает времени, на какой технике выполняется. Всё это — только если сказано продавцом или видно на фото, например на его прайсе;
- characteristics — состав и условия работы: «Что входит», «Сроки», «Выезд», «Оборудование». Разъёмы, объёмы памяти и прочие характеристики вещи здесь не нужны;
- brand и model — обычно null: у услуги их нет. Заполняй только если услуга привязана к конкретной модели техники;
- state — всегда null: к услуге «новый» и «б/у» не относятся.`;

/**
 * Автозаполнение карточки товара по фотографиям.
 *
 * Отдельный модуль, а не третья текстовая операция в image-gen: тот отвечает за
 * картинки, и правка описания попала туда лишь потому, что жила в одном диалоге
 * с генерацией. Здесь другая работа — читать фотографии и раскладывать
 * увиденное по полям карточки, — и свой прайс, не зависящий от себестоимости
 * запроса.
 */
@Injectable()
export class ProductAutofillService {
  private readonly logger = new Logger(ProductAutofillService.name);

  constructor(
    @Inject(OPENROUTER_CLIENT) private readonly router: OpenAI | null,
    private readonly files: FilesService,
    private readonly categories: CategoriesService,
    private readonly shops: ShopsService,
    private readonly credits: CreditsService,
    private readonly aiUsage: AiUsageService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Прайс и остаток — форма спрашивает их до нажатия кнопки, чтобы показать
   * цену рядом с ней и не выдавать отказ уже после клика.
   *
   * Весь расчёт для продавца делает `CreditsService.autofillQuota`: там же
   * живёт и сам резерв (`holdAutofill`), и порядок «безлимит → норма → кредиты»
   * обязан быть один на обе точки. Разложив его здесь во второй раз, мы бы
   * получили ровно тот баг, ради которого правило и заводилось, — подпись
   * «бесплатно» над списанием десяти кредитов, — и заметили бы его по жалобе.
   *
   * Счётчик нормы `autofillQuota` читает с якорем по месяцу (V8), а не из
   * колонки: сброс ленивый, и первого числа там ещё лежит прошлое число.
   *
   * Администратор отвечается литералом и не ходит в базу вовсе: магазина у него
   * нет, а `plan: 'free'` здесь — не «истёкшая подписка», а «тарифа не бывает».
   * Отличить одно от другого форма может по `balance === null`.
   */
  async price(author: Author): Promise<AutofillPriceDto> {
    if (author.isAdmin) {
      return {
        price: AUTOFILL_CREDITS,
        effectivePrice: 0,
        free: true,
        unlimited: true,
        freeLeft: null,
        freeLimit: AUTOFILL_FREE_PER_MONTH,
        resetsAt: null,
        plan: 'free',
        allowed: true,
        balance: null,
      };
    }

    return this.credits.autofillQuota(author.id);
  }

  /**
   * Заполнить карточку по фотографиям.
   *
   * Порядок с деньгами: занять прайс → сходить к модели → разобрать ответ →
   * списать. Списание последним намеренно: продавец платит за заполненные поля,
   * а не за обращение к модели. Ответ, который не удалось разобрать, — наш
   * брак, и себестоимость такого запроса площадка берёт на себя.
   *
   * Поэтому же `settleAutofill` и `cancelAutofill` стоят на взаимоисключающих
   * путях: списание после снятия резерва освободило бы чужой резерв вторым
   * разом.
   *
   * Чем именно оплачено — безлимитом тарифа, месячной нормой или кредитами —
   * решает `holdAutofill`, и здесь это не разбирается сознательно. Тариф вообще
   * не спрашивается: правило «читать план только через `effectiveLimits`»
   * соблюдается тем, что мы не читаем его вовсе. Откат тоже один на все ветки —
   * `cancelAutofill` сам знает, что бесплатной попытке надо вернуть счётчик, а
   * платной — резерв. Отдельная ветка отката здесь означала бы, что продавец,
   * которому модель не ответила, теряет попытку из пяти.
   */
  async fill(
    dto: AutofillProductDto,
    author: Author,
  ): Promise<AutofilledProductDto> {
    if (!this.router) {
      throw new ServiceUnavailableException(
        'OPENROUTER_API_KEY не задан — карточку придётся заполнить вручную',
      );
    }

    const categories = await this.allowedCategories(author);
    const model = this.config.get<string>('openrouter.autofillModel')!;
    const hold = await this.credits.holdAutofill(author);

    let completion: OpenAI.Chat.ChatCompletion;
    let filled: AutofillResult;
    try {
      completion = await this.request(model, dto, categories);
      filled = parseAutofillResult(
        completion.choices[0]?.message?.content,
        new Set(categories.map((category) => category.id)),
      );
    } catch (err) {
      await this.credits.cancelAutofill(hold);

      const details = describeError(err);
      this.logger.error(
        `Карточка «${dto.name}» не заполнена (модель ${model}): ${details}`,
      );

      throw new BadGatewayException(
        (err as { status?: number }).status === 429
          ? `Лимит запросов исчерпан. ${details}`
          : `Не удалось заполнить карточку: ${details}`,
      );
    }

    const credits = await this.settleAndLog(
      hold,
      author,
      usageCost(completion.usage),
      model,
    );

    const outcome = autofillOutcome(hold);
    return {
      ...filled,
      credits,
      balance: await this.balanceAfter(outcome.shopId),
      free: outcome.free,
      freeLeft: outcome.freeLeft,
    };
  }

  /**
   * Доступный остаток магазина после операции — форма обновляет им счётчик, не
   * спрашивая цену заново.
   *
   * Считает `CreditsService.available` (B5), а не `balance − reserved`.
   * Собственная формула здесь знала только про купленные кредиты, и подписчик
   * PRO с шестью тысячами подписочных и нулём купленных получал `balance: 0` —
   * кнопка объявляла «кредиты закончились» сразу после оплаты тарифа. Хуже
   * того, отказ был только на глазах: сам резерв идёт через `AVAILABLE_CREDITS`
   * и прошёл бы, то есть форма запрещала операцию, которую сервер выполнить
   * готов.
   *
   * Магазин приходит из резерва, а не разрешается по владельцу вторым запросом:
   * `holdAutofill` его уже нашёл, и остаток обязан показываться того самого
   * магазина, у которого списали. `null` — администратор, у него лимита нет.
   */
  private async balanceAfter(shopId: number | null): Promise<number | null> {
    if (shopId === null) return null;
    return this.credits.available(shopId);
  }

  /**
   * Списать прайс и записать, кто ходил к модели. Двумя записями, как и в
   * генерации картинок: журнал денег ведётся по магазину и не знает, чьи руки
   * нажали кнопку, а запросы администратора списания не создают вовсе.
   *
   * `ai_usage` пишется на всех ветках, включая бесплатные: себестоимость
   * запроса у площадки одинакова, платит за него продавец кредитами или уже
   * заплатил абонплатой. Отметка `free` разводит эти два случая — без неё
   * `credits = 0` при непустом `shop_id` читалось бы как сбой списания
   * (`settleFixed` в catch возвращает ноль), и разобрать по журналу, что
   * произошло, было бы нечем.
   */
  private async settleAndLog(
    hold: AutofillHold,
    author: Author,
    usd: number | undefined,
    model: string,
  ): Promise<number> {
    const credits = await this.credits.settleAutofill(hold, usd, {
      operation: 'autofill',
      model,
    });
    const outcome = autofillOutcome(hold);
    await this.aiUsage.record({
      userId: author.id,
      shopId: outcome.shopId,
      operation: 'autofill',
      model,
      usd,
      credits,
      free: outcome.free,
    });
    return credits;
  }

  /**
   * Разделы, куда магазин вправе выложить товар.
   *
   * Закрытые без разрешения выкидываем до промпта, а не после: модель, увидев
   * подходящий раздел, назовёт именно его, продавец подставит подсказку в форму
   * и получит отказ при сохранении — за наш недосмотр.
   */
  private async allowedCategories(author: Author): Promise<AutofillCategory[]> {
    const tree = await this.categories.getTree();
    const allowRestricted =
      author.isAdmin || (await this.mayUseRestricted(author));

    const flat: AutofillCategory[] = [];
    const walk = (node: CategoryDto, path: string[]) => {
      if (node.restricted && !allowRestricted) return;

      const label = [...path, node.name.ru];
      /** Только листья: выложить товар в «Ноутбуки» вообще, минуя вид, нельзя. */
      if (node.children.length === 0) {
        flat.push({ id: node.id, label: label.join(' · ') });
        return;
      }
      for (const child of node.children) walk(child, label);
    };
    for (const root of tree) walk(root, []);

    if (flat.length > MAX_PROMPT_CATEGORIES) {
      this.logger.warn(
        `Каталог разросся до ${flat.length} разделов — в промпт уходят первые ${MAX_PROMPT_CATEGORIES}`,
      );
      return flat.slice(0, MAX_PROMPT_CATEGORIES);
    }
    return flat;
  }

  /** Разрешены ли магазину закрытые разделы. Нет магазина — нет и разрешения. */
  private async mayUseRestricted(author: Author): Promise<boolean> {
    const shopId = await this.credits.shopIdOf(author.id);
    if (!shopId) return false;

    const shop = await this.shops.getOrThrowById(shopId);
    return shop.restrictedCategoriesEnabled;
  }

  private async request(
    model: string,
    dto: AutofillProductDto,
    categories: AutofillCategory[],
  ): Promise<OpenAI.Chat.ChatCompletion> {
    const category = await this.categories.describeForCheck(
      dto.categoryId ?? null,
    );
    const content = await this.buildUserContent(dto, categories, category);

    return this.router!.chat.completions.create(
      {
        model,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: category?.isService
              ? `${AUTOFILL_SYSTEM}\n\n${SERVICE_NOTE}`
              : AUTOFILL_SYSTEM,
          },
          { role: 'user', content },
        ],
      },
      { timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES },
    );
  }

  /**
   * Фотографии уходят байтами в data-URL, а не ссылкой на S3 — как и в
   * ИИ-проверке. По ссылке за картинкой ходила бы сама модель, и любая заминка
   * на нашей стороне возвращалась бы как «Timeout while downloading», то есть
   * запрос срывался бы из-за чужого сбоя.
   *
   * `detail: low` у всех кадров: прочитать надписи на корпусе этого хватает, а
   * высокая детализация умножила бы стоимость запроса, цену которого мы уже
   * объявили продавцу.
   */
  private async buildUserContent(
    dto: AutofillProductDto,
    categories: AutofillCategory[],
    category: { label: string; isService: boolean } | null,
  ): Promise<OpenAI.Chat.ChatCompletionContentPart[]> {
    const keys = dto.photoKeys.slice(0, AUTOFILL_MAX_PHOTOS);
    const attached: string[] = [];
    for (const key of keys) {
      try {
        attached.push(await this.files.toDataUrl(key));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Фото ${key} не прочитано из S3: ${message}`);
      }
    }
    /**
     * Без фотографий заполнять нечего: остаётся одно название, по которому
     * модель начнёт домысливать характеристики — ровно то, что запрещено
     * заданием. Лучше отказ и снятый резерв.
     */
    if (attached.length === 0) {
      throw new Error('не удалось прочитать ни одной фотографии товара');
    }

    const existing = (dto.characteristics ?? [])
      .filter((characteristic) => characteristic.key && characteristic.value)
      .map((characteristic) => `${characteristic.key}: ${characteristic.value}`)
      .join('; ');

    const text = [
      `Название от продавца: ${dto.name}`,
      category ? `Категория, выбранная продавцом: ${category.label}` : null,
      dto.state
        ? `Состояние по словам продавца: ${dto.state === 'new' ? 'новый' : 'б/у'}`
        : null,
      dto.description?.trim()
        ? `Описание продавца (сохрани его факты):\n${dto.description.trim()}`
        : 'Описание продавец не написал — составь его по фотографиям.',
      existing
        ? `Характеристики продавца (сохрани их): ${existing}`
        : 'Характеристики продавец не заполнил.',
      `Фотографий приложено: ${attached.length} шт.`,
      '',
      'Разделы каталога — выбери один id или null:',
      ...categories.map((item) => `${item.id} — ${item.label}`),
    ]
      .filter((line) => line !== null)
      .join('\n');

    return [
      { type: 'text', text },
      ...attached.map((url) => ({
        type: 'image_url' as const,
        image_url: { url, detail: 'low' as const },
      })),
    ];
  }
}
