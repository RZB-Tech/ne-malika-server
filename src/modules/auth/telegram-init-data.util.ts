import * as crypto from 'crypto';

export interface TelegramUserPayload {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

export interface ParsedInitData {
  user: TelegramUserPayload;
  authDate: number;
}

/**
 * Валидирует подпись initData Telegram Mini App.
 * Алгоритм: secret = HMAC_SHA256(key="WebAppData", data=bot_token)
 *           hash   = HMAC_SHA256(key=secret, data=data_check_string)
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string,
  ttlSec: number,
): ParsedInitData {
  const params = new URLSearchParams(initData);

  const hash = params.get('hash');
  if (!hash) {
    throw new Error('initData: отсутствует hash');
  }
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(computedHash, 'hex'),
    Buffer.from(hash, 'hex'),
  );
  if (!isValid) {
    throw new Error('initData: неверная подпись');
  }

  const authDate = Number(params.get('auth_date'));
  if (!authDate) {
    throw new Error('initData: отсутствует auth_date');
  }
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (ageSec > ttlSec) {
    throw new Error('initData: срок действия истёк');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('initData: отсутствуют данные пользователя');
  }

  let user: TelegramUserPayload;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new Error('initData: не удалось разобрать поле user');
  }

  if (!user?.id) {
    throw new Error('initData: отсутствует telegram id пользователя');
  }

  return { user, authDate };
}
