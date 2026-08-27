import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ClickMerchantService } from './click-merchant.service';
import {
  CLICK_RESPONSE,
  clickField,
  clickMerchantTransactionId,
  parseClickCallback,
  verifyClickSignature,
} from './click-protocol';
import {
  CLICK_CALLBACK_ACTIONS,
  CLICK_CONTROLLER_ROUTES,
} from './click-routes';
import {
  SubscriptionsService,
  type CompleteResult,
} from './subscriptions.service';

interface ClickAnswer {
  click_trans_id: string;
  merchant_trans_id: string;
  merchant_prepare_id?: number;
  merchant_confirm_id?: number;
  error: number;
  error_note: string;
}

type ClickResponseCode = (typeof CLICK_RESPONSE)[keyof typeof CLICK_RESPONSE];

interface CallbackContext {
  shopId: number | null;
  amount: number;
  trusted: boolean;
}

const LOG_BODY_LIMIT = 1000;

const COMPLETE_FAILURE_CODE: Record<
  'not_found' | 'invalid_amount' | 'mismatch' | 'shop_gone',
  ClickResponseCode
> = {
  not_found: CLICK_RESPONSE.transactionNotFound,
  invalid_amount: CLICK_RESPONSE.invalidAmount,
  mismatch: CLICK_RESPONSE.invalidRequest,
  shop_gone: CLICK_RESPONSE.invalidRequest,
};

const COMPLETE_FAILURE_NOTE: Record<
  'not_found' | 'invalid_amount' | 'mismatch' | 'shop_gone',
  string
> = {
  not_found: 'Complete по транзакции, которой нет в журнале платежей',
  invalid_amount: 'Сумма Complete не совпала с суммой принятого Prepare',
  mismatch: 'Реквизиты Complete не сошлись с сохранённым Prepare',
  shop_gone: 'Магазин перестал быть активным между Prepare и Complete',
};

function bodyForLog(body: Record<string, unknown>): string {
  const safe: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(body)) {
    if (key === 'sign_string') continue;
    safe[key] = raw;
  }
  return JSON.stringify(safe).slice(0, LOG_BODY_LIMIT);
}

function looseAmount(body: Record<string, unknown>): number {
  const parsed = Number(clickField(body, 'amount'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isPaidComplete(body: Record<string, unknown>): boolean {
  return (
    clickField(body, 'action') === '1' &&
    Number(clickField(body, 'error')) === 0
  );
}

@ApiExcludeController()
@Controller(CLICK_CONTROLLER_ROUTES)
export class ClickController {
  private readonly logger = new Logger(ClickController.name);

  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly merchant: ClickMerchantService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @SkipThrottle()
  @Post(CLICK_CALLBACK_ACTIONS)
  @HttpCode(HttpStatus.OK)
  async handle(@Body() body: Record<string, unknown>): Promise<ClickAnswer> {
    const context: CallbackContext = {
      shopId: null,
      amount: looseAmount(body),
      trusted: false,
    };

    this.logger.log(`Колбэк Click: ${bodyForLog(body)}`);

    try {
      return await this.dispatch(body, context);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Колбэк Click сорвался: ${detail} | ${bodyForLog(body)}`,
        error instanceof Error ? error.stack : undefined,
      );

      if (!this.owesRefund(body, context)) {
        return answer(body, CLICK_RESPONSE.invalidRequest);
      }

      return this.failComplete(
        body,
        context,
        `Исключение при обработке Complete: ${detail}`,
      );
    }
  }

  private owesRefund(
    body: Record<string, unknown>,
    context: CallbackContext,
  ): boolean {
    return context.trusted && isPaidComplete(body);
  }

  private async dispatch(
    body: Record<string, unknown>,
    context: CallbackContext,
  ): Promise<ClickAnswer> {
    const secretKey = this.config.get<string>('click.secretKey');
    if (!secretKey) {
      this.logger.error(
        'Колбэк Click отклонён: CLICK_SECRET_KEY не задан — проверить подпись нечем',
      );
      return answer(body, CLICK_RESPONSE.signFailed);
    }
    if (!verifyClickSignature(body, secretKey)) {
      this.logger.warn(`Колбэк Click с неверной подписью: ${bodyForLog(body)}`);
      return answer(body, CLICK_RESPONSE.signFailed);
    }

    const action = clickField(body, 'action');
    if (action !== '0' && action !== '1') {
      this.logger.warn(`Колбэк Click с чужой стадией: ${bodyForLog(body)}`);
      return answer(body, CLICK_RESPONSE.actionNotFound);
    }

    const serviceId = this.config.get<string>('click.serviceId');
    if (!serviceId || clickField(body, 'service_id') !== serviceId) {
      this.logger.error(
        `Колбэк Click по чужой услуге (ожидалась ${serviceId ?? 'не задана'}): ${bodyForLog(body)}`,
      );
      return answer(body, CLICK_RESPONSE.invalidRequest);
    }

    context.trusted = true;

    const callback = parseClickCallback(body);
    if (!callback) {
      const amountText = clickField(body, 'amount');
      const amountBroken =
        !/^\d+(?:\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0;
      this.logger.warn(`Колбэк Click не разобран: ${bodyForLog(body)}`);

      if (this.owesRefund(body, context)) {
        return this.failComplete(
          body,
          context,
          'Complete с нулевым error не разобран по формату протокола',
        );
      }

      return answer(
        body,
        amountBroken
          ? CLICK_RESPONSE.invalidAmount
          : CLICK_RESPONSE.invalidRequest,
      );
    }

    context.amount = callback.amount;

    if (callback.clickError > 0) {
      this.logger.warn(
        `Колбэк Click с ошибкой провайдера ${callback.clickError}: ${bodyForLog(body)}`,
      );
      return answer(body, CLICK_RESPONSE.invalidRequest);
    }

    const order = await this.resolveOrder(callback);
    if (!order) {
      this.logger.warn(
        `Колбэк Click по неизвестному счёту: merchant_trans_id=${callback.merchantTransId}, ` +
          `click_trans_id=${callback.clickTransId}`,
      );

      if (this.owesRefund(body, context)) {
        return this.failComplete(
          body,
          context,
          `Complete по несуществующему счёту (merchant_trans_id=${callback.merchantTransId})`,
        );
      }

      return answer(body, CLICK_RESPONSE.userNotFound);
    }
    context.shopId = order.shopId;

    if (callback.action === 0) {
      return this.prepare(body, callback, order.merchantBillingId);
    }
    return this.complete(body, callback, context, order.shopId);
  }

  private async resolveOrder(
    callback: NonNullable<ReturnType<typeof parseClickCallback>>,
  ) {
    if (callback.merchantTransId) {
      return this.subscriptions.findOrderForPayment(callback.merchantTransId);
    }

    if (callback.action === 1 && callback.merchantPrepareId) {
      return this.subscriptions.findOrderForPayment(callback.merchantPrepareId);
    }

    return this.subscriptions.findOrderByAmount(callback.amount);
  }

  private async prepare(
    body: Record<string, unknown>,
    callback: NonNullable<ReturnType<typeof parseClickCallback>>,
    orderId: number,
  ): Promise<ClickAnswer> {
    if (callback.clickError < 0) {
      return answer(body, CLICK_RESPONSE.cancelled);
    }

    const result = await this.subscriptions.prepare({
      orderId,
      amount: callback.amount,
      providerTransactionId: callback.clickTransId,
      providerPaymentId: callback.clickPaydocId,
      serviceId: callback.serviceId,
      signTime: callback.signTime,
    });

    switch (result.kind) {
      case 'prepared':
        return answer(body, CLICK_RESPONSE.success, {
          merchant_prepare_id: result.payment.merchantBillingId,
        });
      case 'already_paid':
        return answer(body, CLICK_RESPONSE.alreadyPaid);
      case 'cancelled':
        return answer(body, CLICK_RESPONSE.cancelled);
      case 'invalid_amount':
        return answer(body, CLICK_RESPONSE.invalidAmount);
      case 'not_found':
      case 'expired':
        return answer(body, CLICK_RESPONSE.userNotFound);
      case 'shop_gone':
      case 'conflict':
        return answer(body, CLICK_RESPONSE.invalidRequest);
    }
  }

  private async complete(
    body: Record<string, unknown>,
    callback: NonNullable<ReturnType<typeof parseClickCallback>>,
    context: CallbackContext,
    shopId: number,
  ): Promise<ClickAnswer> {
    const result: CompleteResult = await this.subscriptions.complete({
      shopId,
      providerTransactionId: callback.clickTransId,
      providerPaymentId: callback.clickPaydocId,
      merchantPrepareId: callback.merchantPrepareId,
      amount: callback.amount,
      clickError: callback.clickError,
      errorNote: clickField(body, 'error_note') || undefined,
      signTime: callback.signTime,
    });

    switch (result.kind) {
      case 'paid':
        return answer(body, CLICK_RESPONSE.success, {
          merchant_confirm_id: result.payment.merchantBillingId,
        });
      case 'already_paid':
        return answer(body, CLICK_RESPONSE.alreadyPaid);
      case 'cancelled':
        return answer(body, CLICK_RESPONSE.cancelled);
      default:
        break;
    }

    if (!this.owesRefund(body, context)) {
      return answer(body, COMPLETE_FAILURE_CODE[result.kind]);
    }

    return this.failComplete(body, context, COMPLETE_FAILURE_NOTE[result.kind]);
  }

  private async failComplete(
    body: Record<string, unknown>,
    context: CallbackContext,
    note: string,
  ): Promise<ClickAnswer> {
    const providerTransactionId = clickField(body, 'click_trans_id');
    const providerPaymentId = clickField(body, 'click_paydoc_id');

    this.logger.error(
      `Деньги списаны, подписка не выдана: ${note} | ${bodyForLog(body)}`,
    );

    const reversal = await this.merchant.reverse(providerPaymentId);

    await this.subscriptions.recordFailedComplete({
      shopId: context.shopId,
      providerTransactionId,
      providerPaymentId,
      amount: context.amount,
      clickError: Number(clickField(body, 'error')) || 0,
      errorNote: note,
      reversed: reversal.ok,
      reversalNote: reversal.ok
        ? undefined
        : `${reversal.reason}${reversal.detail ? `: ${reversal.detail}` : ''}`,
    });

    if (!reversal.ok) {
      this.logger.error(
        `Вернуть платёж Click не удалось (${reversal.reason}): click_trans_id=${providerTransactionId}, ` +
          `click_paydoc_id=${providerPaymentId}, магазин ${context.shopId ?? 'не определён'}. ` +
          'Строка помечена как требующая разбора — деньги возвращает человек',
      );
    }

    const confirmId = Number(clickField(body, 'merchant_prepare_id'));

    return answer(
      body,
      CLICK_RESPONSE.success,
      Number.isSafeInteger(confirmId) && confirmId > 0
        ? { merchant_confirm_id: confirmId }
        : undefined,
    );
  }
}

function answer(
  body: Record<string, unknown>,
  response: ClickResponseCode,
  extra?: Pick<ClickAnswer, 'merchant_prepare_id' | 'merchant_confirm_id'>,
): ClickAnswer {
  return {
    click_trans_id: clickField(body, 'click_trans_id'),
    merchant_trans_id: clickMerchantTransactionId(body),
    ...extra,
    error: response.error,
    error_note: response.note,
  };
}
