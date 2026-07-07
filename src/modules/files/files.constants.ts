export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 МБ (раздел 8 ТЗ)
export const MAX_PHOTOS_PER_PRODUCT = 10; // раздел 8 ТЗ

/** На сколько минут действительна presigned-ссылка для загрузки. */
export const PRESIGNED_URL_TTL_SEC = 5 * 60;
