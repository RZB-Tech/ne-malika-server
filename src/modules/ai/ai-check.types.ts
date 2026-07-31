export const AI_VERDICTS = ['pass', 'warn', 'fail'] as const;
export type AiVerdict = (typeof AI_VERDICTS)[number];

export const AI_ASPECTS = [
  'description',
  'dataConsistency',
  'photos',
  'photoMatch',
] as const;

export interface AiCheckDetail {
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

/**
 * Разбор ответа модели. Модель отвечает свободным JSON, поэтому доверять форме
 * нельзя: что не распозналось — отбрасываем, вердикт по умолчанию 'warn'
 * (мягче — значит товар не скрывается из-за нашей же ошибки разбора).
 */
export function parseAiCheckResult(
  raw: string | null | undefined,
): AiCheckResult {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
  } catch {
    return {
      verdict: 'warn',
      summary: 'Не удалось разобрать ответ модели',
      checks: {},
    };
  }

  const checks: AiCheckResult['checks'] = {};
  const rawChecks = (parsed.checks ?? {}) as Record<string, unknown>;
  for (const aspect of AI_ASPECTS) {
    const detail = rawChecks[aspect] as
      { verdict?: unknown; notes?: unknown } | undefined;
    const verdict = toVerdict(detail?.verdict);
    if (verdict) {
      const notes = typeof detail?.notes === 'string' ? detail.notes : '';
      checks[aspect] = { verdict, notes };
    }
  }

  return {
    verdict: toVerdict(parsed.verdict) ?? 'warn',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    checks,
  };
}
