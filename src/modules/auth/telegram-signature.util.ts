import * as crypto from 'crypto';

export interface TelegramUserPayload {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

/** Полезная нагрузка Telegram Login Widget: поля пользователя + время и подпись. */
export interface TelegramWidgetPayload extends TelegramUserPayload {
  auth_date: number;
  hash: string;
}

/**
 * Mini App и Login Widget подписываются одним алгоритмом, но разными ключами:
 *   Mini App: secret = HMAC_SHA256(key="WebAppData", data=bot_token)
 *   Widget:   secret = SHA256(bot_token)
 * В обоих случаях hash = HMAC_SHA256(key=secret, data=data_check_string).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * https://core.telegram.org/widgets/login#checking-authorization
 */
function assertSignature(
  dataCheckString: string,
  hash: string,
  secret: Buffer,
): void {
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
  if (!authDate) {
    throw new Error('Telegram: отсутствует auth_date');
  }
  if (Math.floor(Date.now() / 1000) - authDate > ttlSec) {
    throw new Error('Telegram: срок действия данных истёк');
  }
}

/** `key=value`, отсортировано по ключу, через перевод строки. */
function dataCheckString(entries: [string, string][]): string {
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

/** Валидирует initData Telegram Mini App и возвращает пользователя. */
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

/** Валидирует ответ Telegram Login Widget (браузерный вход) и возвращает пользователя. */
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
