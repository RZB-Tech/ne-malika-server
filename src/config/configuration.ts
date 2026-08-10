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

  groq: {
    apiKey: process.env.GROQ_API_KEY,
    // Единственная модель Groq, принимающая изображения: проверка смотрит фото.
    model: process.env.GROQ_MODEL ?? 'qwen/qwen3.6-27b',
    baseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
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
