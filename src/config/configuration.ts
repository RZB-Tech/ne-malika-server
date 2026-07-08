export default () => ({
  env: process.env.NODE_ENV,
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',

  database: {
    url: process.env.DATABASE_URL,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshTtl: process.env.JWT_REFRESH_TTL,
  },
  redis: {
    url: process.env.REDIS_URL,
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    embeddingModel:
      process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    rerankEnabled: process.env.SEARCH_RERANK_ENABLED === 'true',
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
