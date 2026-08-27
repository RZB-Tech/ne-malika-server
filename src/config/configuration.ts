/**
 * Пустая переменная — то же самое, что невыставленная.
 *
 * В `.env.example` незаполненный ключ выглядит как `CLICK_SERVICE_ID=`, и на
 * стенде такая строка доезжает до процесса пустой строкой, а не отсутствием.
 * Обычное `process.env.X ?? 'по умолчанию'` на пустую строку не сработает:
 * `??` ловит только `null`/`undefined`, и вместо умолчания в конфиг легла бы
 * пустота. Отсюда отдельный проход.
 *
 * `trim()` здесь не косметика: docker-compose и CI-секреты приносят значение
 * вместе с концевым пробелом или переводом строки, а `CLICK_SECRET_KEY` уходит
 * в HMAC — с лишним символом подпись каждого колбэка не сойдётся, и найти это
 * по логам почти невозможно.
 */
function envText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/**
 * Число из окружения с умолчанием.
 *
 * Пустое значение — умолчание (см. `envText`); `parseInt('')` вернул бы `NaN`,
 * и цена тарифа стала бы `NaN`, а сравнение суммы платежа с ней — всегда
 * ложью, то есть «неизвестный тариф» на каждую оплату.
 *
 * Мусор вроде `65 000` тоже уводится в умолчание, но незамеченным не остаётся:
 * такое значение до сюда не доходит — `env.validation.ts` роняет старт на
 * `@IsInt()` раньше, чем соберётся конфиг. Ветка нужна лишь на случай вызова
 * фабрики в обход валидации (тесты, скрипты).
 */
function envInt(value: string | undefined, fallback: number): number {
  const text = envText(value);
  if (text === undefined) return fallback;
  const parsed = Number(text);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export default () => ({
  env: process.env.NODE_ENV,
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',

  /** Разрешённые источники для CORS. Пусто — значит «любой», допустимо только вне прода. */
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL,
  },

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    /**
     * Модерация и составление промпта. Модели намеренно без «рассуждений»:
     * у рассуждающих скрытые токены тратят тот же бюджет ответа, из-за чего
     * видимый текст приходит пустым, а строгий JSON ломается.
     */
    model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-4.1-mini',
    /** Промпт по фотографии — работа простая, берём модель подешевле. */
    visionModel: process.env.OPENROUTER_VISION_MODEL ?? 'openai/gpt-4o-mini',
    /**
     * ИИ-сравнение товаров. Оно бесплатно для покупателей, а значит платим за
     * него мы — поэтому здесь самая дешёвая модель из тех, что держат json_object
     * и понимают русский. Работа несложная: характеристики уже собраны, модель
     * их раскладывает по составляющим и сравнивает.
     */
    compareModel: process.env.OPENROUTER_COMPARE_MODEL ?? 'openai/gpt-4.1-nano',
    /**
     * Автозаполнение карточки по фотографиям. Модель нужна зрячая и при этом
     * толковая: она разбирает надписи на корпусе и коробке и раскладывает
     * увиденное по характеристикам, а не просто подписывает картинку. Поэтому
     * не `visionModel`, который дешевле, но на такой работе путает модели и
     * дописывает то, чего на фото нет.
     */
    autofillModel:
      process.env.OPENROUTER_AUTOFILL_MODEL ?? 'openai/gpt-4.1-mini',
    /** Рисование. Идёт не в чат, а в отдельный Images API OpenRouter. */
    imageModel: process.env.OPENROUTER_IMAGE_MODEL ?? 'openai/gpt-image-2',
  },

  /**
   * Ключи VAPID для web push. Без них канал просто выключается: подписка не
   * оформляется, а рассылка уходит только в Telegram.
   */
  webPush: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    /** Контакт для push-сервиса: mailto: или https-адрес. */
    subject: process.env.VAPID_SUBJECT ?? 'mailto:admin@nemalika.uz',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshTtl: process.env.JWT_REFRESH_TTL,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    initDataTtlSec: parseInt(
      process.env.TELEGRAM_INIT_DATA_TTL_SEC ?? '86400',
      10,
    ),
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET,
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    publicBase: process.env.S3_PUBLIC_BASE,
  },

  /**
   * Подписка магазина. Здесь только прайс — и только он.
   *
   * Числа кредитов, сроки и лимиты тарифов лежат в
   * `src/modules/subscriptions/subscriptions.constants.ts`: это часть продукта,
   * одинаковая везде, и возможность потихоньку раздать на одном стенде вдвое
   * больше кредитов никому не нужна. Цена — наоборот, настройка развёртывания:
   * прайс меняют без пересборки образа, а на тестовом стенде он символический,
   * потому что кассу проверяют настоящими деньгами.
   *
   * Тариф в колбэке Click определяется ПО СУММЕ платежа: провайдер сообщает
   * только сколько заплатили, но не за что. Поэтому три числа обязаны быть
   * попарно различны. Сверку делает `SubscriptionsService` при старте, а не
   * валидатор окружения: в валидаторе видны лишь переменные, а совпасть цены
   * могут и на умолчаниях — если задана одна из трёх.
   */
  subscription: {
    priceStartUzs: envInt(process.env.SUBSCRIPTION_PRICE_START_UZS, 65_000),
    priceProUzs: envInt(process.env.SUBSCRIPTION_PRICE_PRO_UZS, 130_000),
    priceMaxUzs: envInt(process.env.SUBSCRIPTION_PRICE_MAX_UZS, 260_000),
    /**
     * Символическая сумма для проверки кассы живыми деньгами.
     *
     * Подписки не даёт вовсе: успешная тестовая оплата доказывает, что подпись
     * сходится, Prepare и Complete доходят и строка в журнале появляется, — а
     * кредиты, срок и уведомления не трогает. Поэтому её незачем возвращать и
     * незачем потом убирать последствия.
     *
     * Принимается не всегда, а только пока администратор держит окно открытым
     * на конкретный магазин (`shops.subscription_test_until`): сумма мимо
     * прайса, принимаемая безусловно, — это подписка за 1000 сум для всех.
     */
    testPriceUzs: envInt(process.env.SUBSCRIPTION_TEST_PRICE_UZS, 1_000),
  },

  /**
   * Click — приём оплаты подписки (docs.click.uz).
   *
   * Все реквизиты необязательны: без них ручка «оплатить» отвечает 503, а всё
   * остальное работает, и подписку по-прежнему можно выдать вручную из админки.
   * Так стенд разработчика поднимается вообще без платёжных ключей, а не с
   * боевыми «на всякий случай».
   */
  click: {
    /** Идентификатор магазина в кабинете Click. Уходит в адрес кассы. */
    merchantId: envText(process.env.CLICK_MERCHANT_ID),
    /**
     * Идентификатор услуги. По его наличию и решается, включён ли Click вообще:
     * он участвует и в подписи колбэка, и в адресе кассы, так что без него не
     * собрать ни одного, ни другого. То же условие — в `env.validation.ts`.
     */
    serviceId: envText(process.env.CLICK_SERVICE_ID),
    /**
     * Секрет из кабинета Click. ОДИН на оба интерфейса: им и проверяется
     * подпись колбэков SHOP API (`md5`), и считается `sha1(timestamp + secret)`
     * в заголовке `Auth` Merchant API.
     *
     * При подключении услуги Click выдаёт ровно четыре значения —
     * `merchant_id`, `service_id`, `merchant_user_id` и `secret_key`.
     * Отдельного «секрета Merchant API» не существует, и заводить под него
     * вторую переменную значит просить у человека то, чего ему не выдавали.
     */
    secretKey: envText(process.env.CLICK_SECRET_KEY),
    /**
     * Идентификатор пользователя кабинета — вторая половина заголовка `Auth`
     * (`merchant_user_id:sha1(timestamp+secret):timestamp`). Нужен ровно для
     * одного: вернуть уже списанные деньги через Merchant API, когда выдать
     * подписку не получилось. Поэтому в production обязателен вместе с
     * остальным Click — принимать оплату, не умея её вернуть, нельзя.
     *
     * Это идентификатор, а не секрет: секретность держится на `secretKey`.
     */
    merchantUserId: envText(process.env.CLICK_MERCHANT_USER_ID),
    merchantApiUrl:
      envText(process.env.CLICK_MERCHANT_API_URL) ??
      'https://api.click.uz/v2/merchant',
    /**
     * Таймаут запроса возврата. Секунды, а не минуты: возврат вызывается прямо
     * из обработчика Complete, а Click ждёт ответ ограниченное время и при
     * молчании повторяет запрос — зависший возврат обернулся бы вторым
     * Complete по той же транзакции.
     */
    reversalTimeoutMs: envInt(process.env.CLICK_REVERSAL_TIMEOUT_MS, 5_000),
  },
});
