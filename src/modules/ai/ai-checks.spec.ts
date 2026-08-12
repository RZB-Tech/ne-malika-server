import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProductCard } from '../../db/schema';
import { parseAiCheckResult } from './ai-check.types';
import { obviousContentViolation } from './ai-checks.service';

function card(name: string): ProductCard {
  return { name } as ProductCard;
}

describe('local product moderation', () => {
  it('rejects test placeholders and repeated keyboard noise', () => {
    for (const name of ['sdf', 'sdfsdf', 'ASD-ASD', 'тест12', 'qwerty']) {
      assert.ok(obviousContentViolation(card(name)), name);
    }
  });

  it('does not reject a meaningful product name', () => {
    assert.equal(
      obviousContentViolation(card('Видеокарта RTX 4070 Super')),
      null,
    );
  });
});

describe('AI moderation response parsing', () => {
  it('promotes the overall verdict to the worst required check', () => {
    const result = parseAiCheckResult(
      JSON.stringify({
        verdict: 'pass',
        summary: 'Фото не соответствует товару',
        checks: {
          description: { verdict: 'pass', notes: '' },
          dataConsistency: { verdict: 'pass', notes: '' },
          photos: { verdict: 'pass', notes: '' },
          photoMatch: { verdict: 'fail', notes: 'На фото другой товар' },
        },
      }),
    );
    assert.equal(result.verdict, 'fail');
  });

  it('rejects incomplete responses instead of publishing them', () => {
    assert.throws(
      () =>
        parseAiCheckResult(
          JSON.stringify({ verdict: 'pass', summary: '', checks: {} }),
        ),
      /корректный verdict/,
    );
  });
});
