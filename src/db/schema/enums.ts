import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['user', 'seller', 'admin']);

export const productStateEnum = pgEnum('product_state', ['new', 'old']);

export const entityStatusEnum = pgEnum('entity_status', [
  'active',
  'abolished',
  'hidden',
  'pending',
]);

export const aiVerdictEnum = pgEnum('ai_verdict', ['pass', 'warn', 'fail']);

export const broadcastAudienceEnum = pgEnum('broadcast_audience', [
  'all',
  'sellers',
  'buyers',
]);

export const creditTxnKindEnum = pgEnum('credit_txn_kind', [
  'grant',
  'spend',
  'refund',
  'adjust',
]);

export const reviewStatusEnum = pgEnum('review_status', [
  'pending',
  'approved',
  'rejected',
]);

export const chatMessageKindEnum = pgEnum('chat_message_kind', [
  'buyer',
  'seller',
  'ai',
]);

export const subscriptionPlanEnum = pgEnum('subscription_plan', [
  'free',
  'start',
  'pro',
  'max',
]);

export const paymentProviderEnum = pgEnum('payment_provider', [
  'click',
  'payme',
  'manual',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'prepared',
  'paid',
  'cancelled',
  'failed',
]);

export const moderationStatusEnum = pgEnum('moderation_status', [
  'pending',
  'approved',
  'rejected',
]);

export const subscriptionReminderStageEnum = pgEnum(
  'subscription_reminder_stage',
  ['expiring_3d', 'expires_today'],
);
