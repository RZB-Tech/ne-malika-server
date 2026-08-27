export const TZ = 'Asia/Tashkent';

const BOT_UA =
  /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|telegrambot|whatsapp|preview|headless|lighthouse|pingdom|curl|wget|python-requests|axios|go-http/i;

export function isBot(userAgent: string | undefined): boolean {
  return userAgent !== undefined && BOT_UA.test(userAgent);
}

export function today(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

export function monthStart(now: Date = new Date()): string {
  return `${today(now).slice(0, 7)}-01`;
}

export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) days.push(d);
  return days;
}
