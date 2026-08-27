import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validate } from './env.validation';

const baseConfig = {
  NODE_ENV: 'test',
  PORT: 3001,
  API_PREFIX: 'api/v1',
  DATABASE_URL: 'postgres://test:test@localhost/test',
  JWT_ACCESS_SECRET: 'test-access-secret',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  JWT_REFRESH_TTL: '30d',
  TELEGRAM_INIT_DATA_TTL_SEC: 3600,
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'test-bucket',
};

/**
 * В production включаются ещё две условные проверки, к Click отношения не
 * имеющие. Без них тест на Click падал бы по чужой причине и «зеленел» бы
 * даже после поломки самого условия.
 */
const productionConfig = {
  ...baseConfig,
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://nemalika.uz',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
};

describe('environment validation', () => {
  it('allows the AWS default credential chain when S3 keys are omitted', () => {
    assert.doesNotThrow(() => validate(baseConfig));
  });

  it('treats empty S3 key variables as omitted', () => {
    assert.doesNotThrow(() =>
      validate({ ...baseConfig, S3_ACCESS_KEY: '', S3_SECRET_KEY: '   ' }),
    );
  });

  it('requires both S3 keys when either one is configured', () => {
    assert.throws(
      () => validate({ ...baseConfig, S3_ACCESS_KEY: 'access-key' }),
      /S3_SECRET_KEY is required with S3_ACCESS_KEY/,
    );
  });

  it('поднимается без единого реквизита Click', () => {
    assert.doesNotThrow(() => validate(baseConfig));
  });

  /**
   * Признак «Click включён» — service_id. Один лишь секрет ничего не включает:
   * так стенд, которому ключ достался из общего секретохранилища, но услуга не
   * заведена, обязан подниматься.
   */
  it('пропускает CLICK_SECRET_KEY без CLICK_SERVICE_ID', () => {
    assert.doesNotThrow(() =>
      validate({ ...baseConfig, CLICK_SECRET_KEY: 'secret' }),
    );
  });

  it('требует CLICK_SECRET_KEY вместе с CLICK_SERVICE_ID', () => {
    assert.throws(
      () => validate({ ...baseConfig, CLICK_SERVICE_ID: '12345' }),
      /CLICK_SECRET_KEY обязателен вместе с CLICK_SERVICE_ID/,
    );
  });

  /** Пустая строка — это невыставленная переменная, а не включённый Click. */
  it('считает пустые реквизиты Click отсутствующими', () => {
    assert.doesNotThrow(() =>
      validate({
        ...baseConfig,
        CLICK_SERVICE_ID: '   ',
        CLICK_SECRET_KEY: '',
        CLICK_MERCHANT_ID: '',
      }),
    );
  });

  it('в production требует CLICK_MERCHANT_USER_ID вместе с CLICK_SERVICE_ID', () => {
    assert.throws(
      () =>
        validate({
          ...productionConfig,
          CLICK_SERVICE_ID: '12345',
          CLICK_SECRET_KEY: 'secret',
        }),
      /CLICK_MERCHANT_USER_ID обязателен в production/,
    );
  });

  /**
   * Возврату не нужен второй секрет: Click выдаёт на услугу один `secret_key`,
   * общий для подписи колбэков SHOP API и заголовка Auth у Merchant API.
   * Четырёх реквизитов — merchant_id, service_id, merchant_user_id, secret_key —
   * достаточно, и пятого просить не у кого.
   */
  it('не требует отдельного секрета Merchant API', () => {
    assert.doesNotThrow(() =>
      validate({
        ...productionConfig,
        CLICK_MERCHANT_ID: '54321',
        CLICK_SERVICE_ID: '12345',
        CLICK_SECRET_KEY: 'secret',
        CLICK_MERCHANT_USER_ID: 'merchant-user',
      }),
    );
  });

  /**
   * Требование реквизитов возврата привязано к самому Click, а не к окружению:
   * прод без приёма оплаты — законная конфигурация (подписки выдаются вручную),
   * и требовать для неё реквизиты возврата не за что.
   */
  it('в production без Click реквизиты Merchant API не нужны', () => {
    assert.doesNotThrow(() => validate(productionConfig));
  });

  it('принимает полностью настроенный Click в production', () => {
    assert.doesNotThrow(() =>
      validate({
        ...productionConfig,
        CLICK_MERCHANT_ID: '54321',
        CLICK_SERVICE_ID: '12345',
        CLICK_SECRET_KEY: 'secret',
        CLICK_MERCHANT_USER_ID: 'merchant-user',
        CLICK_MERCHANT_API_URL: 'https://api.click.uz/v2/merchant',
        CLICK_REVERSAL_TIMEOUT_MS: '5000',
        CLICK_RETURN_URL: 'https://nemalika.uz/seller/subscription',
      }),
    );
  });

  /**
   * Главная ловушка числовых переменных: `Number('')` — ноль, а не NaN.
   * Без обработчика пустой строки `SUBSCRIPTION_PRICE_START_UZS=` в .env
   * превратился бы в `0` и уронил старт на `@Min(1)`.
   */
  it('считает пустые числовые переменные отсутствующими', () => {
    assert.doesNotThrow(() =>
      validate({
        ...baseConfig,
        SUBSCRIPTION_PRICE_START_UZS: '',
        SUBSCRIPTION_PRICE_PRO_UZS: '   ',
        CLICK_REVERSAL_TIMEOUT_MS: '',
      }),
    );
  });

  it('принимает цены строками, как их отдаёт process.env', () => {
    assert.doesNotThrow(() =>
      validate({
        ...baseConfig,
        SUBSCRIPTION_PRICE_START_UZS: '65000',
        SUBSCRIPTION_PRICE_PRO_UZS: '130000',
        SUBSCRIPTION_PRICE_MAX_UZS: '260000',
      }),
    );
  });

  it('отвергает нечисловую и нулевую цену подписки', () => {
    assert.throws(
      () => validate({ ...baseConfig, SUBSCRIPTION_PRICE_PRO_UZS: '130 000' }),
      /SUBSCRIPTION_PRICE_PRO_UZS/,
    );

    assert.throws(
      () => validate({ ...baseConfig, SUBSCRIPTION_PRICE_MAX_UZS: '0' }),
      /SUBSCRIPTION_PRICE_MAX_UZS/,
    );
  });

  /** Возврат идёт в чужой API: таймаут меньше секунды — гарантированный отказ. */
  it('отвергает слишком короткий таймаут возврата', () => {
    assert.throws(
      () => validate({ ...baseConfig, CLICK_REVERSAL_TIMEOUT_MS: '200' }),
      /CLICK_REVERSAL_TIMEOUT_MS/,
    );
  });
});
