import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  type TelegramWidgetPayload,
  validateTelegramWidgetData,
} from './telegram-signature.util';

const BOT_TOKEN = '123456:test-token';
const TTL_SEC = 60;

function signedWidget(
  overrides: Partial<TelegramWidgetPayload> = {},
): TelegramWidgetPayload {
  const fields = {
    id: 42,
    first_name: 'Malika',
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  const entries = Object.entries(fields)
    .filter(([key, value]) => key !== 'hash' && value != null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('\n');
  const secret = createHash('sha256').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(entries).digest('hex');

  return { ...fields, hash } as TelegramWidgetPayload;
}

describe('Telegram signature validation', () => {
  it('accepts a fresh correctly signed widget payload', () => {
    const result = validateTelegramWidgetData(
      signedWidget(),
      BOT_TOKEN,
      TTL_SEC,
    );
    assert.equal(result.id, 42);
  });

  it('rejects an expired payload', () => {
    const payload = signedWidget({
      auth_date: Math.floor(Date.now() / 1000) - TTL_SEC - 1,
    });
    assert.throws(
      () => validateTelegramWidgetData(payload, BOT_TOKEN, TTL_SEC),
      /истёк/,
    );
  });

  it('rejects auth_date beyond the allowed future clock skew', () => {
    const payload = signedWidget({
      auth_date: Math.floor(Date.now() / 1000) + 31,
    });
    assert.throws(
      () => validateTelegramWidgetData(payload, BOT_TOKEN, TTL_SEC),
      /будущем/,
    );
  });

  it('rejects malformed hashes without throwing a buffer length error', () => {
    const payload = signedWidget();
    payload.hash = 'z'.repeat(64);
    assert.throws(
      () => validateTelegramWidgetData(payload, BOT_TOKEN, TTL_SEC),
      /формат подписи/,
    );
  });
});
