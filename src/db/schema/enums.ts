import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * `user` — обычный покупатель, роль по умолчанию при регистрации через Telegram.
 * В `seller` он переходит сам, в момент создания магазина; `admin` назначается
 * вручную другим администратором.
 */
export const userRoleEnum = pgEnum('user_role', ['user', 'seller', 'admin']);

export const productStateEnum = pgEnum('product_state', ['new', 'old']);

export const entityStatusEnum = pgEnum('entity_status', [
  'active',
  'abolished',
  'hidden',
]);

export const aiVerdictEnum = pgEnum('ai_verdict', ['pass', 'warn', 'fail']);
