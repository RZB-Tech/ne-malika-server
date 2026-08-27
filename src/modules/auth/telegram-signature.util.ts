import * as crypto from 'crypto';

export interface TelegramUserPayload {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

export interface TelegramWidgetPayload extends TelegramUserPayload {
  auth_date: number;
  hash: string;
}

const MAX_FUTURE_CLOCK_SKEW_SEC = 30;

function assertSignature(
  dataCheckString: string,
  hash: string,
  secret: Buffer,
): void {
  if (!/^[a-f\d]{64}$/i.test(hash)) {
    throw new Error('Telegram: неверный формат подписи');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  if (
    expected.length !== hash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(hash, 'hex'),
    )
  ) {
    throw new Error('Telegram: неверная подпись');
  }
}

function assertFresh(authDate: number, ttlSec: number): void {
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    throw new Error('Telegram: отсутствует auth_date');
  }
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (ageSec < -MAX_FUTURE_CLOCK_SKEW_SEC) {
    throw new Error('Telegram: auth_date находится в будущем');
  }
  if (ageSec > ttlSec) {
    throw new Error('Telegram: срок действия данных истёк');
  }
}

function dataCheckString(entries: [string, string][]): string {
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  ttlSec: number,
): TelegramUserPayload {
  const params = new URLSearchParams(initData);

  const hash = params.get('hash');
  if (!hash) {
    throw new Error('initData: отсутствует hash');
  }
  params.delete('hash');

  const secret = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  assertSignature(dataCheckString([...params.entries()]), hash, secret);
  assertFresh(Number(params.get('auth_date')), ttlSec);

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('initData: отсутствуют данные пользователя');
  }

  let user: TelegramUserPayload;
  try {
    user = JSON.parse(userRaw) as TelegramUserPayload;
  } catch {
    throw new Error('initData: не удалось разобрать поле user');
  }
  if (!user?.id) {
    throw new Error('initData: отсутствует telegram id пользователя');
  }

  return user;
}

export function validateTelegramWidgetData(
  payload: TelegramWidgetPayload,
  botToken: string,
  ttlSec: number,
): TelegramUserPayload {
  const { hash, ...fields } = payload;

  const entries = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)] as [string, string]);

  const secret = crypto.createHash('sha256').update(botToken).digest();
  assertSignature(dataCheckString(entries), hash, secret);
  assertFresh(payload.auth_date, ttlSec);

  return fields;
}
