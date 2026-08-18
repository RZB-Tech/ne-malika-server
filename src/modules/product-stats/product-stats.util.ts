/**
 * Чистые помощники счётчика: календарь площадки и отсев роботов.
 *
 * Вынесены из сервиса, чтобы проверяться тестом напрямую — без поднятия
 * контейнера Nest ради двух функций над строками.
 */

/**
 * Часовой пояс площадки. Сутки статистики режутся по нему, а не по UTC: продавец
 * в Ташкенте, открыв график в девять вечера, должен видеть сегодняшние просмотры
 * сегодня, а не размазанными по двум столбикам.
 */
export const TZ = 'Asia/Tashkent';

/**
 * Поисковые и превью-боты. Их заходы — не просмотры товара, и без отсева каждый
 * обход поисковика приезжал бы продавцу как интерес покупателей. Ровно эту
 * работу раньше делала за нас Метрика своим фильтром роботов.
 *
 * Список заведомо неполон, и это нормально: пропущенный бот завышает счётчик на
 * единицы, тогда как случайно пойманный браузер терял бы реального покупателя.
 */
const BOT_UA =
  /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|telegrambot|whatsapp|preview|headless|lighthouse|pingdom|curl|wget|python-requests|axios|go-http/i;

export function isBot(userAgent: string | undefined): boolean {
  return userAgent !== undefined && BOT_UA.test(userAgent);
}

/** Сегодняшняя дата площадки в формате YYYY-MM-DD. */
export function today(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

/**
 * Сдвиг календарной даты на сутки. Считается в UTC намеренно: строка уже
 * содержит местную дату, и повторный учёт пояса сместил бы её ещё раз.
 */
export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Сплошной ряд дат, включая пустые сутки. Без него в графике не будет разницы
 * между «в этот день никто не заходил» и «этого дня нет», а столбики поедут.
 */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) days.push(d);
  return days;
}
