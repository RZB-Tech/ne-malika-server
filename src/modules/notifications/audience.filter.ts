import { SQL, eq } from 'drizzle-orm';
import { users } from '../../db/schema';
import type { BroadcastAudience } from './dto/create-broadcast.dto';

/**
 * Общий фильтр аудитории рассылки для Telegram- и push-каналов:
 * sellers/buyers сужают выборку по роли, all — не добавляет условий.
 */
export function audienceRoleFilter(
  audience: BroadcastAudience,
): SQL | undefined {
  return audience === 'sellers'
    ? eq(users.role, 'seller')
    : audience === 'buyers'
      ? eq(users.role, 'user')
      : undefined;
}
