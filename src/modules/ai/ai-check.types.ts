const AI_VERDICTS = ['pass', 'warn', 'fail'] as const;
export type AiVerdict = (typeof AI_VERDICTS)[number];

export const AI_ASPECTS = [
  'description',
  'dataConsistency',
  'photos',
  'photoMatch',
] as const;

interface AiCheckDetail {
  verdict: AiVerdict;
  notes: string;
}

export interface AiCheckResult {
  verdict: AiVerdict;
  summary: string;
  checks: Partial<Record<(typeof AI_ASPECTS)[number], AiCheckDetail>>;
}

function toVerdict(value: unknown): AiVerdict | null {
  return AI_VERDICTS.includes(value as AiVerdict) ? (value as AiVerdict) : null;
}

const VERDICT_WEIGHT: Record<AiVerdict, number> = {
  pass: 0,
  warn: 1,
  fail: 2,
};

export function parseAiCheckResult(
  raw: string | null | undefined,
): AiCheckResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
  } catch {
    throw new Error('Не удалось разобрать JSON-ответ модели');
  }

  const checks: AiCheckResult['checks'] = {};
  if (!parsed.checks || typeof parsed.checks !== 'object') {
    throw new Error('Модель не вернула обязательный объект checks');
  }
  const rawChecks = parsed.checks as Record<string, unknown>;
  for (const aspect of AI_ASPECTS) {
    const detail = rawChecks[aspect] as
      { verdict?: unknown; notes?: unknown } | undefined;
    const verdict = toVerdict(detail?.verdict);
    if (!verdict) {
      throw new Error(`Модель не вернула корректный verdict для ${aspect}`);
    }
    const notes = typeof detail?.notes === 'string' ? detail.notes : '';
    checks[aspect] = { verdict, notes };
  }

  const declaredVerdict = toVerdict(parsed.verdict);
  if (!declaredVerdict) throw new Error('Модель не вернула итоговый verdict');
  const verdict = Object.values(checks).reduce<AiVerdict>(
    (worst, detail) =>
      detail && VERDICT_WEIGHT[detail.verdict] > VERDICT_WEIGHT[worst]
        ? detail.verdict
        : worst,
    declaredVerdict,
  );

  return {
    verdict,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    checks,
  };
}
