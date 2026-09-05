function envText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function envInt(value: string | undefined, fallback: number): number {
  const text = envText(value);
  if (text === undefined) return fallback;
  const parsed = Number(text);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export default () => ({
  env: process.env.NODE_ENV,
  port: envInt(process.env.PORT, 3000),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',

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
    model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-4.1-mini',
    visionModel: process.env.OPENROUTER_VISION_MODEL ?? 'openai/gpt-4o-mini',
    compareModel: process.env.OPENROUTER_COMPARE_MODEL ?? 'openai/gpt-4.1-nano',
    assistantModel:
      envText(process.env.OPENROUTER_ASSISTANT_MODEL) ?? 'openai/gpt-4o-mini',
    autofillModel:
      process.env.OPENROUTER_AUTOFILL_MODEL ?? 'openai/gpt-4.1-mini',
    imageModel: process.env.OPENROUTER_IMAGE_MODEL ?? 'openai/gpt-image-2',
  },

  webPush: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
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
    initDataTtlSec: envInt(process.env.TELEGRAM_INIT_DATA_TTL_SEC, 86_400),
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

  subscription: {
    priceStartUzs: envInt(process.env.SUBSCRIPTION_PRICE_START_UZS, 65_000),
    priceProUzs: envInt(process.env.SUBSCRIPTION_PRICE_PRO_UZS, 130_000),
    priceMaxUzs: envInt(process.env.SUBSCRIPTION_PRICE_MAX_UZS, 260_000),
    testPriceUzs: envInt(process.env.SUBSCRIPTION_TEST_PRICE_UZS, 1_000),
  },

  payme: {
    merchantId: envText(process.env.PAYME_MERCHANT_ID),
    key: envText(process.env.PAYME_KEY),
    checkoutUrl:
      envText(process.env.PAYME_CHECKOUT_URL) ?? 'https://checkout.paycom.uz',
    accountField: envText(process.env.PAYME_ACCOUNT_FIELD) ?? 'order_id',
    sandboxTtlMin: envInt(process.env.PAYME_SANDBOX_ORDER_TTL_MIN, 720),
    fiscal: {
      ikpu: envText(process.env.PAYME_FISCAL_IKPU),
      packageCode: envText(process.env.PAYME_FISCAL_PACKAGE_CODE),
      vatPercent: envInt(process.env.PAYME_FISCAL_VAT_PERCENT, 12),
      receiptType: envInt(process.env.PAYME_FISCAL_RECEIPT_TYPE, 0),
    },
  },

  click: {
    merchantId: envText(process.env.CLICK_MERCHANT_ID),
    serviceId: envText(process.env.CLICK_SERVICE_ID),
    secretKey: envText(process.env.CLICK_SECRET_KEY),
    merchantUserId: envText(process.env.CLICK_MERCHANT_USER_ID),
    merchantApiUrl:
      envText(process.env.CLICK_MERCHANT_API_URL) ??
      'https://api.click.uz/v2/merchant',
    reversalTimeoutMs: envInt(process.env.CLICK_REVERSAL_TIMEOUT_MS, 5_000),
  },
});
