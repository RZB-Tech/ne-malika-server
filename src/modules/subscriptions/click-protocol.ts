import { createHash, timingSafeEqual } from 'node:crypto';

export const CLICK_RESPONSE = {
  success: { error: 0, note: 'Success' },
  signFailed: { error: -1, note: 'SIGN CHECK FAILED!' },
  invalidAmount: { error: -2, note: 'Incorrect parameter amount' },
  actionNotFound: { error: -3, note: 'Action not found' },
  alreadyPaid: { error: -4, note: 'Already paid' },
  userNotFound: { error: -5, note: 'User does not exist' },
  transactionNotFound: { error: -6, note: 'Transaction does not exist' },
  updateFailed: { error: -7, note: 'Failed to update user' },
  invalidRequest: { error: -8, note: 'Error in request from click' },
  cancelled: { error: -9, note: 'Transaction cancelled' },
} as const;

export type ClickAction = 0 | 1;

export interface ClickCallback {
  clickTransId: string;
  clickPaydocId: string;
  serviceId: string;
  merchantTransId: string;
  merchantPrepareId: string;
  amount: number;
  amountText: string;
  action: ClickAction;
  clickError: number;
  signTime: string;
  signString: string;
}

export function clickField(body: Record<string, unknown>, key: string): string {
  const raw = body[key];
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

export function clickMerchantTransactionId(
  body: Record<string, unknown>,
): string {
  return (
    clickField(body, 'merchant_trans_id') ||
    clickField(body, 'transaction_param')
  );
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createClickSignature(
  body: Record<string, unknown>,
  secretKey: string,
): string {
  const clickTransId = clickField(body, 'click_trans_id');
  const serviceId = clickField(body, 'service_id');
  const merchantTransId = clickField(body, 'merchant_trans_id');
  const merchantPrepareId = clickField(body, 'merchant_prepare_id');
  const amount = clickField(body, 'amount');
  const action = clickField(body, 'action');
  const signTime = clickField(body, 'sign_time');

  const signSource =
    action === '0'
      ? `${clickTransId}${serviceId}${secretKey}${merchantTransId}${amount}${action}${signTime}`
      : `${clickTransId}${serviceId}${secretKey}${merchantTransId}${merchantPrepareId}${amount}${action}${signTime}`;

  return createHash('md5').update(signSource).digest('hex').toLowerCase();
}

export function verifyClickSignature(
  body: Record<string, unknown>,
  secretKey: string,
): boolean {
  if (!secretKey) return false;
  return timingSafeStringEqual(
    createClickSignature(body, secretKey),
    clickField(body, 'sign_string').toLowerCase(),
  );
}

function isInteger(valueToCheck: string): boolean {
  return /^-?\d+$/.test(valueToCheck);
}

export function parseClickCallback(
  body: Record<string, unknown>,
): ClickCallback | null {
  const clickTransId = clickField(body, 'click_trans_id');
  const clickPaydocId = clickField(body, 'click_paydoc_id');
  const serviceId = clickField(body, 'service_id');
  const merchantTransId = clickMerchantTransactionId(body);
  const merchantPrepareId = clickField(body, 'merchant_prepare_id');
  const amountText = clickField(body, 'amount');
  const actionText = clickField(body, 'action');
  const errorText = clickField(body, 'error');
  const signTime = clickField(body, 'sign_time');
  const signString = clickField(body, 'sign_string');

  if (
    !/^\d+$/.test(clickTransId) ||
    !/^\d+$/.test(clickPaydocId) ||
    !/^\d+$/.test(serviceId) ||
    !merchantTransId ||
    !/^\d+(?:\.\d{1,2})?$/.test(amountText) ||
    !isInteger(actionText) ||
    !isInteger(errorText) ||
    !signTime ||
    !/^[a-f\d]{32}$/i.test(signString)
  ) {
    return null;
  }

  const actionNumber = Number(actionText);
  if (actionNumber !== 0 && actionNumber !== 1) return null;
  if (actionNumber === 1 && !/^\d+$/.test(merchantPrepareId)) return null;

  const amount = Number(amountText);
  const clickError = Number(errorText);
  if (
    !Number.isSafeInteger(clickError) ||
    !Number.isFinite(amount) ||
    amount <= 0
  )
    return null;

  return {
    clickTransId,
    clickPaydocId,
    serviceId,
    merchantTransId,
    merchantPrepareId,
    amount,
    amountText,
    action: actionNumber,
    clickError,
    signTime,
    signString: signString.toLowerCase(),
  };
}

export function createClickMerchantAuth(
  merchantUserId: string,
  secretKey: string,
  timestamp: number,
): string {
  const digest = createHash('sha1')
    .update(`${timestamp}${secretKey}`)
    .digest('hex');
  return `${merchantUserId}:${digest}:${timestamp}`;
}

export function createClickPaymentUrl(input: {
  serviceId: string;
  merchantId: string;
  amountUzs: number;
  transactionParam: string;
  returnUrl?: string;
}): string {
  const params = new URLSearchParams({
    service_id: input.serviceId,
    merchant_id: input.merchantId,
    amount: input.amountUzs.toFixed(2),
    transaction_param: input.transactionParam,
  });
  if (input.returnUrl) params.set('return_url', input.returnUrl);
  return `https://my.click.uz/services/pay?${params.toString()}`;
}
