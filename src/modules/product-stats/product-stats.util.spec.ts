import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eachDay, isBot, shiftDay, today } from './product-stats.util';

describe('календарь статистики', () => {
  it('сдвигает дату через границу месяца', () => {
    assert.equal(shiftDay('2026-08-31', 1), '2026-09-01');
    assert.equal(shiftDay('2026-09-01', -1), '2026-08-31');
  });

  it('сдвигает дату через границу года и високосный февраль', () => {
    assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
    assert.equal(shiftDay('2028-02-28', 1), '2028-02-29');
  });

  it('строит период из 30 суток включительно с обоих концов', () => {
    const to = '2026-08-18';
    const days = eachDay(shiftDay(to, -29), to);

    assert.equal(days.length, 30);
    assert.equal(days[0], '2026-07-20');
    assert.equal(days.at(-1), to);
  });

  it('не пропускает сутки внутри ряда', () => {
    const days = eachDay('2026-02-27', '2026-03-02');
    assert.deepEqual(days, [
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  /**
   * Ташкент — UTC+5, поэтому с 19:00 UTC там уже следующие сутки. Ровно из-за
   * этого дата берётся по поясу площадки: иначе вечерние просмотры уезжали бы
   * в завтрашний столбик графика.
   */
  it('режет сутки по поясу площадки, а не по UTC', () => {
    assert.equal(today(new Date('2026-08-18T19:30:00Z')), '2026-08-19');
    assert.equal(today(new Date('2026-08-18T18:30:00Z')), '2026-08-18');
  });
});

describe('отсев роботов', () => {
  it('узнаёт поисковых и превью-ботов', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
      'Mozilla/5.0 (compatible; Googlebot/2.1)',
      'TelegramBot (like TwitterBot)',
      'curl/8.4.0',
      'python-requests/2.31.0',
    ]) {
      assert.equal(isBot(ua), true, ua);
    }
  });

  it('пропускает обычные браузеры', () => {
    for (const ua of [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ]) {
      assert.equal(isBot(ua), false, ua);
    }
  });

  /** Заголовка может не быть вовсе — это не повод терять просмотр. */
  it('считает запрос без User-Agent человеческим', () => {
    assert.equal(isBot(undefined), false);
  });
});
