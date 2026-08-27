import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { broadcastAudienceEnum } from './enums';
import { users } from './users.schema';

export const broadcasts = pgTable(
  'broadcasts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    authorId: bigint('author_id', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),

    audience: broadcastAudienceEnum('audience').notNull(),

    text: text('text').notNull(),

    recipients: integer('recipients').notNull().default(0),
    delivered: integer('delivered').notNull().default(0),
    failed: integer('failed').notNull().default(0),

    pushDelivered: integer('push_delivered').notNull().default(0),
    pushFailed: integer('push_failed').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    createdAtIdx: index('broadcasts_created_at_idx').on(
      sql`${table.createdAt} DESC`,
    ),
  }),
);

export type Broadcast = typeof broadcasts.$inferSelect;
