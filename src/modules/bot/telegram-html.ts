/**
 * Подготовка текста для Telegram с parse_mode=HTML.
 *
 * Собрано в одном месте: раньше escapeHtml был скопирован в reports.service,
 * ai-checks.service и seller-nudge.service — три одинаковых функции, которые
 * разошлись бы молча при первой же правке.
 */

/** Потолок Telegram на sendMessage. Больше — ответ 400, сообщение теряется. */
export const TELEGRAM_MAX_MESSAGE = 4096;

/** Экранирует то, что подставляется в разметку: названия, имена, тексты жалоб. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Обрезает вставку до разумной длины. Нужна там, где в текст попадает чужой
 * ввод или сообщение об ошибке: они бывают в килобайты, а всё сообщение
 * целиком не должно упереться в лимит Telegram.
 */
export function excerpt(value: string, limit = 300): string {
  const text = value.trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Последняя защита перед отправкой. Режем по символам с запасом на то, что
 * Telegram считает длину в UTF-16, и не разрываем HTML-тег посередине —
 * оборванный тег даёт 400 «can't parse entities» вместо усечённого текста.
 */
export function clampMessage(text: string): string {
  if (text.length <= TELEGRAM_MAX_MESSAGE) return text;

  const cut = text.slice(0, TELEGRAM_MAX_MESSAGE - 1);
  const lastOpen = cut.lastIndexOf('<');
  const lastClose = cut.lastIndexOf('>');
  const safe = lastOpen > lastClose ? cut.slice(0, lastOpen) : cut;
  return `${safe}…`;
}
