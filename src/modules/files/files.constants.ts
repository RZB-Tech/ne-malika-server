export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_PRODUCT = 10;

export const PRESIGNED_URL_TTL_SEC = 5 * 60;
