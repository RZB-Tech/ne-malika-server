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

/**
 * Тариф магазина. `free` — состояние по умолчанию и то, во что магазин
 * возвращается по истечении оплаченного периода: отдельного значения
 * «просрочен» нет намеренно, иначе одно и то же — «платных возможностей нет» —
 * пришлось бы проверять двумя способами.
 *
 * Именно enum, а не varchar, как у `ai_usage.operation`: от тарифа зависят
 * права (баннер, лимит бесплатных автозаполнений, вес в витрине, глубина
 * аналитики), и опечатка в строке молча выдала бы магазину чужой набор.
 * Все четыре значения объявлены сразу: `ALTER TYPE … ADD VALUE` нельзя
 * использовать в том же прогоне миграций, где оно добавлено (см. 0010), а
 * прогон у нас один на все непринятые файлы.
 */
export const subscriptionPlanEnum = pgEnum('subscription_plan', [
  'free',
  'start',
  'pro',
  'max',
]);

/**
 * Кто провёл платёж. `manual` — ручная активация администратором: у неё нет
 * идентификаторов провайдера, но строка в журнале обязана быть, иначе
 * `shops.subscription_until` разъедется с историей и разбирать спор будет нечем.
 */
export const paymentProviderEnum = pgEnum('payment_provider', [
  'click',
  'payme',
  'manual',
]);

/**
 * Состояние платежа в терминах двухфазного протокола Click.
 *
 * `prepared` — прошёл Prepare. Денег на этой стадии никто не трогал: Prepare
 * лишь спрашивает, готовы ли мы принять счёт, списание происходит на Complete.
 * Поэтому брошенный в `prepared` платёж — это оставленная касса, а не
 * зависшие деньги: возвращать по такой строке нечего, её нужно просто закрыть.
 * `paid` — прошёл Complete, деньги списаны и период начислен. `cancelled` —
 * отменён самим Click или возвращён нами через Merchant API reversal.
 *
 * `pending` и `failed` сейчас не пишутся ни разу: строка заводится только на
 * Prepare, а отказ Prepare деньгами не подкреплён и в журнал не попадает.
 * Объявлены заранее ровно по той же причине, что и четыре тарифа: добавить
 * значение к живому типу дороже, чем объявить его пустым.
 */
export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'prepared',
  'paid',
  'cancelled',
  'failed',
]);

/**
 * Модерация пользовательского контента: ждёт решения, опубликован, отклонён.
 *
 * Отдельный тип, а не `review_status` с теми же значениями: имя типа врёт про
 * предмет, а переименовать его нельзя, не тронув `reviews`. И не
 * `entity_status`: там нет `rejected`, а `abolished`/`hidden` — про снятие
 * администратором и про сокрытие владельцем, то есть про другое.
 */
export const moderationStatusEnum = pgEnum('moderation_status', [
  'pending',
  'approved',
  'rejected',
]);

/**
 * За сколько напоминаем об истечении подписки: за трое суток и в последний
 * оплаченный день. Два раза, а не пять: напоминание о деньгах, повторённое
 * лишний раз, читается как выпрашивание и выключает уведомления целиком.
 */
export const subscriptionReminderStageEnum = pgEnum(
  'subscription_reminder_stage',
  ['expiring_3d', 'expires_today'],
);
