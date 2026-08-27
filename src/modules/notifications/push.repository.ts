import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { pushSubscriptions, users } from '../../db/schema';
import type { BroadcastAudience } from './dto/create-broadcast.dto';
import { audienceRoleFilter } from './audience.filter';

export interface PushTarget {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const TARGET_FIELDS = {
  id: pushSubscriptions.id,
  endpoint: pushSubscriptions.endpoint,
  p256dh: pushSubscriptions.p256dh,
  auth: pushSubscriptions.auth,
};

@Injectable()
export class PushRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async upsert(data: {
    userId: number;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
  }): Promise<void> {
    await this.db
      .insert(pushSubscriptions)
      .values(data)
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: data.userId,
          p256dh: data.p256dh,
          auth: data.auth,
          userAgent: data.userAgent,
        },
      });
  }

  async remove(userId: number, endpoint: string): Promise<void> {
    await this.db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, endpoint),
          eq(pushSubscriptions.userId, userId),
        ),
      );
  }

  async removeMany(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .delete(pushSubscriptions)
      .where(inArray(pushSubscriptions.id, ids));
  }

  private audienceWhere(audience: BroadcastAudience) {
    const base = isNull(users.blockedAt);
    return and(base, audienceRoleFilter(audience)) ?? base;
  }

  audience(audience: BroadcastAudience): Promise<PushTarget[]> {
    return this.db
      .select(TARGET_FIELDS)
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(this.audienceWhere(audience));
  }

  byUser(userId: number): Promise<PushTarget[]> {
    return this.db
      .select(TARGET_FIELDS)
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(
        and(eq(pushSubscriptions.userId, userId), isNull(users.blockedAt)),
      );
  }

  countAudience(audience: BroadcastAudience): Promise<number> {
    return this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(this.audienceWhere(audience))
      .then((rows) => rows[0]?.count ?? 0);
  }

  async has(userId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .limit(1);
    return rows.length > 0;
  }
}
