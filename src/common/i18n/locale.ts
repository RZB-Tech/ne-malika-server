/**
 * Языки интерфейса. Те же три, что и на клиенте: русский и узбекский в двух
 * письменностях. Список закрыт — новые языки не планируются.
 */
export const API_LOCALES = ['ru', 'uz-Latn', 'uz-Cyrl'] as const;
export type ApiLocale = (typeof API_LOCALES)[number];

export const DEFAULT_LOCALE: ApiLocale = 'ru';

/**
 * Язык запроса по заголовку Accept-Language. Клиент присылает готовый код
 * («uz-Latn»), но заголовок может прийти и от браузера в общем виде
 * («uz-UZ,uz;q=0.9»), поэтому разбираем обе формы.
 *
 * Узбекский без указания письменности считаем латиницей: так пишет большинство,
 * и именно этот вариант стоит первым в переключателе языка.
 */
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
