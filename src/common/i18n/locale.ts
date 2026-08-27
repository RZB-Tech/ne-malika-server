export const API_LOCALES = ['ru', 'uz-Latn', 'uz-Cyrl'] as const;
export type ApiLocale = (typeof API_LOCALES)[number];

export const DEFAULT_LOCALE: ApiLocale = 'ru';

export function resolveLocale(header: string | undefined): ApiLocale {
  if (!header) return DEFAULT_LOCALE;

  for (const raw of header.split(',')) {
    const tag = raw.split(';')[0].trim().toLowerCase();
    if (!tag) continue;
    if (tag.startsWith('uz')) {
      return tag.includes('cyrl') ? 'uz-Cyrl' : 'uz-Latn';
    }
    if (tag.startsWith('ru')) return 'ru';
  }

  return DEFAULT_LOCALE;
}
