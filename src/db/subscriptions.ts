import { sql, type SQL } from 'drizzle-orm';
import { shops } from './schema';

export const SUBSCRIPTION_ACTIVE: SQL = sql`(${shops.subscriptionPlan} <> 'free' AND ${shops.subscriptionUntil} > now())`;

export const USABLE_SUBSCRIPTION_CREDITS: SQL = sql`(case when ${SUBSCRIPTION_ACTIVE} then ${shops.subscriptionCredits} else 0 end)`;

export const AVAILABLE_CREDITS: SQL = sql`(${shops.creditsBalance} + ${USABLE_SUBSCRIPTION_CREDITS} - ${shops.creditsReserved})`;
