import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClickMerchantAuth } from './click-protocol';

export type ClickReversalResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'not_configured' | 'invalid_payment_id' | 'request_failed';
      detail?: string;
    };

interface ClickMerchantResponse {
  error_code?: number;
  error_note?: string;
}

const DEFAULT_MERCHANT_API_URL = 'https://api.click.uz/v2/merchant';
const DEFAULT_REVERSAL_TIMEOUT_MS = 5_000;

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
    const merchantUserId = this.config.get<string>('click.merchantUserId')!;
    const secretKey = this.config.get<string>('click.secretKey')!;
    const baseUrl = (
      this.config.get<string>('click.merchantApiUrl') ??
      DEFAULT_MERCHANT_API_URL
    ).replace(/\/+$/, '');
    const timeoutMs =
      this.config.get<number>('click.reversalTimeoutMs') ??
      DEFAULT_REVERSAL_TIMEOUT_MS;

    const timestamp = Math.floor(Date.now() / 1000);
    const auth = createClickMerchantAuth(merchantUserId, secretKey, timestamp);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `${baseUrl}/payment/reversal/${encodeURIComponent(serviceId)}/${encodeURIComponent(paymentId)}`,
        {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Auth: auth,
          },
          signal: controller.signal,
        },
      );

      const payload = (await response
        .json()
        .catch(() => null)) as ClickMerchantResponse | null;

      if (response.ok && payload?.error_code === 0) {
        this.logger.warn(`Платёж Click ${paymentId} возвращён покупателю`);
        return { ok: true };
      }

      const detail = payload?.error_note ?? `HTTP ${response.status}`;
      this.logger.error(
        `Возврат платежа Click ${paymentId} отклонён: ${detail}`,
      );
      return { ok: false, reason: 'request_failed', detail };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Возврат платежа Click ${paymentId} не прошёл: ${detail}`,
      );
      return { ok: false, reason: 'request_failed', detail };
    } finally {
      clearTimeout(timeout);
    }
  }
}
