import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * `user` — обычный покупатель, роль по умолчанию при регистрации через Telegram.
 * В `seller` он переходит сам, в момент создания магазина; `admin` назначается
 * вручную другим администратором.
 */
export const userRoleEnum = pgEnum('user_role', ['user', 'seller', 'admin']);

export const productStateEnum = pgEnum('product_state', ['new', 'old']);

/**
 * `pending` — товар создан, но ещё не прошёл ИИ-проверку: в публичную выдачу
 * не попадает. Магазины этот статус не используют — тип общий с product_cards.
 */
export const entityStatusEnum = pgEnum('entity_status', [
  'active',
  'abolished',
  'hidden',
  'pending',
]);

export const aiVerdictEnum = pgEnum('ai_verdict', ['pass', 'warn', 'fail']);

/** Кому уходит рассылка из админки: всем, только продавцам или только покупателям. */
export const broadcastAudienceEnum = pgEnum('broadcast_audience', [
  'all',
  'sellers',
  'buyers',
]);

/**
 * Движение кредитов: `grant` — выдача администратором, `spend` — списание за
 * запрос к модели, `refund` — возврат неиспользованного резерва,
 * `adjust` — ручная правка баланса.
 */
export const creditTxnKindEnum = pgEnum('credit_txn_kind', [
  'grant',
  'spend',
  'refund',
  'adjust',
]);

/**
 * Отзыв ждёт модерации, опубликован или отклонён. И в выдаче, и в рейтинге
 * учитывается только `approved`: до решения человека отзыв не должен ни висеть
 * на карточке, ни менять оценку магазина.
 */
export const reviewStatusEnum = pgEnum('review_status', [
  'pending',
  'approved',
  'rejected',
]);

/**
 * Чей голос в переписке. `ai` — ответ, составленный за продавца моделью:
 * отдельный вид, а не догадка по отправителю, потому что покупатель вправе
 * знать, что отвечал ему не человек.
 */
export const chatMessageKindEnum = pgEnum('chat_message_kind', [
  'buyer',
  'seller',
  'ai',
]);
