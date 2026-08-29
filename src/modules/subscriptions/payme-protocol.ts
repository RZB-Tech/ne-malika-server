import { timingSafeEqual } from 'node:crypto';

/**
 * Протокол Merchant API Payme: коды, разбор запроса и сборка ссылки на кассу.
 * Документация: https://developer.help.paycom.uz/protokol-merchant-api/
 *
 * Суммы у Payme всегда в тийинах — 1 сум = 100 тийин. В нашей базе платёж
 * хранится в сумах (numeric 14,2), поэтому все сравнения идут через тийины.
 */

export const PAYME_STATE = {
  created: 1,
  performed: 2,
  cancelled: -1,
  cancelledAfterPerform: -2,
} as const;

export type PaymeState = (typeof PAYME_STATE)[keyof typeof PAYME_STATE];

export const PAYME_CANCEL_REASON = {
  receiverNotFound: 1,
  debitFailed: 2,
  executionFailed: 3,
  timeout: 4,
  refund: 5,
  unknown: 10,
} as const;

/** Отмена по таймауту: транзакция в состоянии 1 живёт 12 часов. */
export const PAYME_TIMEOUT_MS = 43_200_000;

export const PAYME_METHODS = [
  'CheckPerformTransaction',
  'CreateTransaction',
  'PerformTransaction',
  'CancelTransaction',
  'CheckTransaction',
  'GetStatement',
] as const;

export type PaymeMethod = (typeof PAYME_METHODS)[number];

export interface PaymeLocalizedMessage {
  ru: string;
  uz: string;
  en: string;
}

export interface PaymeErrorBody {
  code: number;
  message: PaymeLocalizedMessage;
  data?: string;
}

/**
 * Ошибка протокола. Наружу уходит не HTTP-статусом, а телом JSON-RPC:
 * Payme считает ошибкой транспорта любой ответ, кроме 200.
 */
export class PaymeRpcError extends Error {
  constructor(
    readonly code: number,
    readonly localized: PaymeLocalizedMessage,
    readonly data?: string,
  ) {
    super(localized.ru);
    this.name = 'PaymeRpcError';
  }

  body(): PaymeErrorBody {
    return this.data === undefined
      ? { code: this.code, message: this.localized }
      : { code: this.code, message: this.localized, data: this.data };
  }
}

function message(ru: string, uz: string, en: string): PaymeLocalizedMessage {
  return { ru, uz, en };
}

export const PAYME_ERROR = {
  parse: () =>
    new PaymeRpcError(
      -32700,
      message(
        'Не удалось разобрать JSON',
        'JSON tahlil qilinmadi',
        'Could not parse JSON',
      ),
    ),
  invalidRequest: (data?: string) =>
    new PaymeRpcError(
      -32600,
      message('Неверный запрос', 'Notoʻgʻri soʻrov', 'Invalid request'),
      data,
    ),
  methodNotFound: (data?: string) =>
    new PaymeRpcError(
      -32601,
      message('Метод не найден', 'Metod topilmadi', 'Method not found'),
      data,
    ),
  insufficientPrivilege: () =>
    new PaymeRpcError(
      -32504,
      message(
        'Недостаточно привилегий для выполнения метода',
        'Metodni bajarish uchun huquqlar yetarli emas',
        'Insufficient privilege to perform this method',
      ),
    ),
  internal: (data?: string) =>
    new PaymeRpcError(
      -32400,
      message('Внутренняя ошибка', 'Ichki xatolik', 'Internal error'),
      data,
    ),
  invalidAmount: () =>
    new PaymeRpcError(
      -31001,
      message('Неверная сумма', 'Notoʻgʻri summa', 'Invalid amount'),
    ),
  transactionNotFound: () =>
    new PaymeRpcError(
      -31003,
      message(
        'Транзакция не найдена',
        'Tranzaksiya topilmadi',
        'Transaction not found',
      ),
    ),
  cannotCancel: () =>
    new PaymeRpcError(
      -31007,
      message(
        'Заказ выполнен. Отмена невозможна',
        'Buyurtma bajarilgan. Bekor qilib boʻlmaydi',
        'Order is completed. Cancellation is not possible',
      ),
    ),
  cannotPerform: (data?: string) =>
    new PaymeRpcError(
      -31008,
      message(
        'Невозможно выполнить операцию',
        'Amalni bajarib boʻlmaydi',
        'Unable to perform operation',
      ),
      data,
    ),
  orderNotFound: (field: string) =>
    new PaymeRpcError(
      -31050,
      message('Заказ не найден', 'Buyurtma topilmadi', 'Order not found'),
      field,
    ),
  orderNotPayable: (field: string) =>
    new PaymeRpcError(
      -31051,
      message(
        'Заказ нельзя оплатить',
        'Buyurtmani toʻlab boʻlmaydi',
        'Order cannot be paid',
      ),
      field,
    ),
} as const;

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

/**
 * Basic-авторизация кассы: логин всегда Paycom, пароль — ключ кассы
 * (тестовый в песочнице, боевой на проде).
 */
export function verifyPaymeAuth(
  header: string | undefined,
  key: string | undefined,
): boolean {
  if (!key) return false;
  if (typeof header !== 'string') return false;

  const [scheme, encoded] = header.trim().split(/\s+/, 2);
  if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return false;
  }

  const separator = decoded.indexOf(':');
  if (separator < 0) return false;

  const login = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  return login === 'Paycom' && safeEqual(password, key);
}

export function uzsToTiyin(amountUzs: number): number {
  return Math.round(amountUzs * 100);
}

export function tiyinToUzs(amountTiyin: number): number {
  return Math.round(amountTiyin) / 100;
}

export interface PaymeRequest {
  method: PaymeMethod;
  params: Record<string, unknown>;
  id: number | string | null;
}

export function requestId(body: unknown): number | string | null {
  if (!body || typeof body !== 'object') return null;
  const id = (body as Record<string, unknown>).id;
  return typeof id === 'number' || typeof id === 'string' ? id : null;
}

export function parsePaymeRequest(body: unknown): PaymeRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw PAYME_ERROR.invalidRequest();
  }

  const raw = body as Record<string, unknown>;
  const method = raw.method;
  if (typeof method !== 'string') throw PAYME_ERROR.invalidRequest('method');
  if (!(PAYME_METHODS as readonly string[]).includes(method)) {
    throw PAYME_ERROR.methodNotFound(method);
  }

  const params = raw.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw PAYME_ERROR.invalidRequest('params');
  }

  return {
    method: method as PaymeMethod,
    params: params as Record<string, unknown>,
    id: requestId(raw),
  };
}

/** Идентификатор транзакции на стороне Payme. */
export function paramTransactionId(params: Record<string, unknown>): string {
  const id = params.id;
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw PAYME_ERROR.invalidRequest('id');
  }
  return id.trim();
}

export function paramAmountTiyin(params: Record<string, unknown>): number {
  const amount = params.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw PAYME_ERROR.invalidAmount();
  }
  return Math.round(amount);
}

export function paramTime(
  params: Record<string, unknown>,
  key: string,
): number {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw PAYME_ERROR.invalidRequest(key);
  }
  return value;
}

export function paramReason(params: Record<string, unknown>): number | null {
  const reason = params.reason;
  if (reason === undefined || reason === null) return null;
  if (typeof reason !== 'number' || !Number.isSafeInteger(reason)) {
    throw PAYME_ERROR.invalidRequest('reason');
  }
  return reason;
}

/**
 * Номер заказа из account. Поле называется так, как его назвали при создании
 * кассы (обычно order_id) — имя приходит из конфигурации, а не зашито в код.
 */
export function paramOrderId(
  params: Record<string, unknown>,
  field: string,
): number {
  const account = params.account;
  if (!account || typeof account !== 'object' || Array.isArray(account)) {
    throw PAYME_ERROR.orderNotFound(field);
  }

  const raw = (account as Record<string, unknown>)[field];
  const text =
    typeof raw === 'string'
      ? raw.trim()
      : typeof raw === 'number'
        ? String(raw)
        : '';

  if (!/^\d{1,10}$/.test(text)) throw PAYME_ERROR.orderNotFound(field);

  const orderId = Number(text);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    throw PAYME_ERROR.orderNotFound(field);
  }
  return orderId;
}

export interface PaymeFiscalItem {
  title: string;
  price: number;
  count: number;
  code: string;
  vat_percent: number;
  package_code?: string;
}

export interface PaymeFiscalDetail {
  receipt_type: number;
  items: PaymeFiscalItem[];
}

/**
 * Фискальный чек для CheckPerformTransaction. Сумма транзакции обязана
 * сойтись с суммой позиций: price * count. Продаём одну услугу — подписку,
 * поэтому позиция ровно одна и её цена равна всей сумме заказа.
 */
export function buildFiscalDetail(input: {
  title: string;
  amountTiyin: number;
  ikpu?: string;
  packageCode?: string;
  vatPercent: number;
  receiptType: number;
}): PaymeFiscalDetail | undefined {
  if (!input.ikpu) return undefined;

  const item: PaymeFiscalItem = {
    title: input.title,
    price: input.amountTiyin,
    count: 1,
    code: input.ikpu,
    vat_percent: input.vatPercent,
  };
  if (input.packageCode) item.package_code = input.packageCode;

  return { receipt_type: input.receiptType, items: [item] };
}

/**
 * Ссылка на кассу методом GET: параметры склеиваются через «;» и кодируются
 * base64. Сумма — в тийинах.
 * https://developer.help.paycom.uz/initsializatsiya-platezhey/otpravka-cheka-po-metodu-get
 */
export function createPaymeCheckoutUrl(input: {
  checkoutUrl: string;
  merchantId: string;
  accountField: string;
  orderId: number | string;
  amountTiyin: number;
  lang?: string;
  callbackUrl?: string;
  callbackTimeoutMs?: number;
}): string {
  const parts = [
    'm=' + input.merchantId,
    'ac.' + input.accountField + '=' + String(input.orderId),
    'a=' + String(input.amountTiyin),
  ];
  if (input.callbackUrl) parts.push('c=' + input.callbackUrl);
  if (input.callbackTimeoutMs) {
    parts.push('ct=' + String(input.callbackTimeoutMs));
  }
  parts.push('l=' + (input.lang ?? 'ru'));

  const encoded = Buffer.from(parts.join(';'), 'utf8').toString('base64');
  return input.checkoutUrl.replace(/\/+$/, '') + '/' + encoded;
}
