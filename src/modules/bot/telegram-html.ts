const TELEGRAM_MAX_MESSAGE = 4096;

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function excerpt(value: string, limit = 300): string {
  const text = value.trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function clampMessage(text: string): string {
  if (text.length <= TELEGRAM_MAX_MESSAGE) return text;

  const cut = text.slice(0, TELEGRAM_MAX_MESSAGE - 1);
  const lastOpen = cut.lastIndexOf('<');
  const lastClose = cut.lastIndexOf('>');
  const safe = lastOpen > lastClose ? cut.slice(0, lastOpen) : cut;
  return `${safe}…`;
}
