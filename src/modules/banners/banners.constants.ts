import { moderationStatusEnum } from '../../db/schema';

const BANNER_FORMATS = [
  { width: 1942, height: 809 },
  { width: 1240, height: 400 },
] as const;

export const BANNER_FORMATS_LABEL = BANNER_FORMATS.map(
  (f) => `${f.width}×${f.height}`,
).join(' / ');

export const MAX_ACTIVE_BANNERS = 10;

export const SHOP_BANNER_SLOTS = 4;

export const SHOP_BANNER_ROTATION_SEC = 300;

export function bucketKey(now: Date = new Date()): string {
  const windowMs = SHOP_BANNER_ROTATION_SEC * 1000;
  return String(Math.floor(now.getTime() / windowMs));
}

export const BANNER_MODERATION_STATUSES = moderationStatusEnum.enumValues;
export type BannerModerationStatus =
  (typeof BANNER_MODERATION_STATUSES)[number];

export const BANNER_MODERATION_DECISIONS = [
  'approved',
  'rejected',
] as const satisfies readonly BannerModerationStatus[];
export type BannerModerationDecision =
  (typeof BANNER_MODERATION_DECISIONS)[number];
