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
    /** Модерация товаров: нужен разбор фото и связный вердикт в JSON. */
    model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-5-mini',
    /** Промпт по фотографии — работа простая, берём модель подешевле. */
    visionModel: process.env.OPENROUTER_VISION_MODEL ?? 'openai/gpt-5-nano',
    /** Рисование. Идёт не в чат, а в отдельный Images API OpenRouter. */
    imageModel: process.env.OPENROUTER_IMAGE_MODEL ?? 'openai/gpt-image-2',
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
});
