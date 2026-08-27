import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClickMerchantAuth } from './click-protocol';
import { errorMessage } from '../../common/errors';

export type ClickReversalResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'not_configured' | 'invalid_payment_id' | 'request_failed';
      detail?: string;
    };

export type ClickInvoiceResult =
  | { ok: true; invoiceId: number }
  | {
      ok: false;
      reason: 'not_configured' | 'invalid_phone' | 'request_failed';
      detail?: string;
    };

export type ClickInvoiceState =
  | { ok: true; status: number; note: string }
  | { ok: false; reason: 'not_configured' | 'request_failed'; detail?: string };

interface ClickMerchantResponse {
  error_code?: number;
  error_note?: string;
  invoice_id?: number;
  id?: number;
  invoice_status?: number;
  invoice_status_note?: string;
  status?: number | null;
  status_note?: string | null;
}

const DEFAULT_MERCHANT_API_URL = 'https://api.click.uz/v2/merchant';
const DEFAULT_REVERSAL_TIMEOUT_MS = 5_000;

export function normalizeUzPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (/^998\d{9}$/.test(digits)) return digits;
  if (/^\d{9}$/.test(digits)) return `998${digits}`;
  return null;
}

@Injectable()
export class ClickMerchantService {
  private readonly logger = new Logger(ClickMerchantService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('click.serviceId') &&
      this.config.get<string>('click.merchantUserId') &&
      this.config.get<string>('click.secretKey'),
    );
  }

  private baseUrl(): string {
    return (
      this.config.get<string>('click.merchantApiUrl') ??
      DEFAULT_MERCHANT_API_URL
    ).replace(/\/+$/, '');
  }

  private async call(
    url: string,
    method: string,
    body?: unknown,
  ): Promise<{
    ok: boolean;
    status: number;
    payload: ClickMerchantResponse | null;
  }> {
    const timeoutMs =
      this.config.get<number>('click.reversalTimeoutMs') ??
      DEFAULT_REVERSAL_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Auth: createClickMerchantAuth(
            this.config.get<string>('click.merchantUserId')!,
            this.config.get<string>('click.secretKey')!,
            Math.floor(Date.now() / 1000),
          ),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = (await response
        .json()
        .catch(() => null)) as ClickMerchantResponse | null;
      return { ok: response.ok, status: response.status, payload };
    } finally {
      clearTimeout(timeout);
    }
  }

  async createInvoice(input: {
    phone: string;
    amountUzs: number;
    merchantTransId: string;
  }): Promise<ClickInvoiceResult> {
    if (!this.isConfigured()) {
      this.logger.error(
        'Счёт Click не выставить: не заданы CLICK_SERVICE_ID / CLICK_MERCHANT_USER_ID / CLICK_SECRET_KEY',
      );
      return { ok: false, reason: 'not_configured' };
    }

    const phone = normalizeUzPhone(input.phone);
    if (!phone) return { ok: false, reason: 'invalid_phone' };

    try {
      const { ok, status, payload } = await this.call(
        `${this.baseUrl()}/invoice/create`,
        'POST',
        {
          service_id: Number(this.config.get<string>('click.serviceId')),
          amount: input.amountUzs,
          phone_number: phone,
          merchant_trans_id: input.merchantTransId,
        },
      );

      const invoiceId = payload?.invoice_id ?? payload?.id;
      if (ok && payload?.error_code === 0 && invoiceId) {
        this.logger.log(
          `Счёт Click ${invoiceId} выставлен на ${phone}: заказ ${input.merchantTransId}, ${input.amountUzs} UZS`,
        );
        return { ok: true, invoiceId };
      }

      const detail =
        payload?.error_note ?? `HTTP ${status}, code ${payload?.error_code}`;
      this.logger.error(
        `Click отклонил счёт на ${phone} (заказ ${input.merchantTransId}): ${detail}`,
      );
      return { ok: false, reason: 'request_failed', detail };
    } catch (error) {
      const detail = errorMessage(error);
      this.logger.error(`Счёт Click не выставлен: ${detail}`);
      return { ok: false, reason: 'request_failed', detail };
    }
  }

  async invoiceState(invoiceId: number): Promise<ClickInvoiceState> {
    if (!this.isConfigured()) return { ok: false, reason: 'not_configured' };

    const serviceId = this.config.get<string>('click.serviceId')!;

    try {
      const { ok, status, payload } = await this.call(
        `${this.baseUrl()}/invoice/status/${encodeURIComponent(serviceId)}/${invoiceId}`,
        'GET',
      );

      if (ok && payload?.error_code === 0) {
        return {
          ok: true,
          status: payload.status ?? payload.invoice_status ?? 0,
          note: payload.status_note ?? payload.invoice_status_note ?? '',
        };
      }

      return {
        ok: false,
        reason: 'request_failed',
        detail: payload?.error_note ?? `HTTP ${status}`,
      };
    } catch (error) {
      return {
        ok: false,
        reason: 'request_failed',
        detail: errorMessage(error),
      };
    }
  }

  async reverse(paymentId: string): Promise<ClickReversalResult> {
    if (!/^\d+$/.test(paymentId)) {
      this.logger.error(
        `Возврат Click невозможен: номер платёжного документа не число (${paymentId})`,
      );
      return { ok: false, reason: 'invalid_payment_id' };
    }

    if (!this.isConfigured()) {
      this.logger.error(
        'Возврат Click невозможен: не заданы CLICK_SERVICE_ID / CLICK_MERCHANT_USER_ID / CLICK_SECRET_KEY',
      );
      return { ok: false, reason: 'not_configured' };
    }

    const serviceId = this.config.get<string>('click.serviceId')!;

    try {
      const { ok, status, payload } = await this.call(
        `${this.baseUrl()}/payment/reversal/${encodeURIComponent(serviceId)}/${encodeURIComponent(paymentId)}`,
        'DELETE',
      );

      if (ok && payload?.error_code === 0) {
        this.logger.warn(`Платёж Click ${paymentId} возвращён покупателю`);
        return { ok: true };
      }

      const detail = payload?.error_note ?? `HTTP ${status}`;
      this.logger.error(
        `Возврат платежа Click ${paymentId} отклонён: ${detail}`,
      );
      return { ok: false, reason: 'request_failed', detail };
    } catch (error) {
      const detail = errorMessage(error);
      this.logger.error(
        `Возврат платежа Click ${paymentId} не прошёл: ${detail}`,
      );
      return { ok: false, reason: 'request_failed', detail };
    }
  }
}
