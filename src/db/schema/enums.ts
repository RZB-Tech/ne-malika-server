import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['seller', 'admin']);

export const productStateEnum = pgEnum('product_state', ['new', 'old']);

export const entityStatusEnum = pgEnum('entity_status', [
  'active',
  'abolished',
  'hidden',
]);

export const analyticsEventTypeEnum = pgEnum('analytics_event_type', [
  'product_view',
  'shop_view',
  'telegram_click',
  'phone_click',
  'search_prompt',
]);

export const aiVerdictEnum = pgEnum('ai_verdict', ['pass', 'warn', 'fail']);
