import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeUzPhone } from './click-merchant.service';

describe('номер телефона для счёта Click', () => {
  it('принимает полный номер в разных написаниях', () => {
    for (const raw of [
      '998901234567',
      '+998901234567',
      '+998 90 123 45 67',
      '(998) 90-123-45-67',
    ]) {
      assert.equal(normalizeUzPhone(raw), '998901234567', raw);
    }
  });

  it('дописывает код страны к девяти цифрам', () => {
    assert.equal(normalizeUzPhone('901234567'), '998901234567');
    assert.equal(normalizeUzPhone('90 123 45 67'), '998901234567');
  });

  it('отвергает всё, что не складывается в номер', () => {
    for (const raw of [
      '',
      '   ',
      '12345',
      '9012345678',
      '9989012345678',
      'телефон',
    ]) {
      assert.equal(normalizeUzPhone(raw), null, raw);
    }
  });
});
