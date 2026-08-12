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
});
