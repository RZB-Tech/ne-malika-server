import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');

export type DrizzleDb = NodePgDatabase<typeof schema>;

/**
 * Транзакция drizzle — то, что получает колбэк `db.transaction()`.
 *
 * Живёт рядом с самим соединением, а не в `rating.ts`, где появился впервые:
 * тип нужен всему, что обязано выполняться в одном коммите с вызывающей
 * правкой (пересчёт рейтинга, выдача подписочных кредитов, запись платежа), и
 * импорт «транзакции из файла про рейтинги» врал бы про предмет. В `rating.ts`
 * оставлен реэкспорт — чтобы уже написанные импорты продолжали работать.
 */
export type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

export const drizzleProvider: Provider = {
  provide: DRIZZLE,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const pool = new Pool({
      connectionString: config.get<string>('database.url'),
    });
    return drizzle(pool, { schema });
  },
};
