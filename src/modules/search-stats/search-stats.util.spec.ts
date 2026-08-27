import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SEARCH_QUERY_MAX_LENGTH,
  normalizeSearchQuery,
} from './search-stats.util';

describe('нормализация поискового запроса', () => {
  it('схлопывает регистр и повторные пробелы', () => {
    assert.equal(normalizeSearchQuery('  Ноутбук   ASUS '), 'ноутбук asus');
    assert.equal(
      normalizeSearchQuery('НОУТБУК'),
      normalizeSearchQuery('ноутбук'),
    );
  });

  it('считает пробелом перевод строки и табуляцию', () => {
    assert.equal(normalizeSearchQuery('ноутбук\n\tasus'), 'ноутбук asus');
  });

  it('отбрасывает запрос короче порога', () => {
    assert.equal(normalizeSearchQuery('но'), null);
    assert.equal(normalizeSearchQuery('  а  '), null);
    assert.equal(normalizeSearchQuery(''), null);
    assert.equal(normalizeSearchQuery('ноу'), 'ноу');
  });

  it('обрезает длинный запрос по ширине колонки', () => {
    const result = normalizeSearchQuery(
      `${'а'.repeat(SEARCH_QUERY_MAX_LENGTH)} хвост`,
    );

    assert.equal(result, 'а'.repeat(SEARCH_QUERY_MAX_LENGTH));
  });

  it('не оставляет хвостового пробела, если срез пришёлся на него', () => {
    const result = normalizeSearchQuery(
      `${'а'.repeat(SEARCH_QUERY_MAX_LENGTH - 1)} хвост`,
    );

    assert.equal(result, 'а'.repeat(SEARCH_QUERY_MAX_LENGTH - 1));
  });
});
