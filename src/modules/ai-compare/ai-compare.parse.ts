import type {
  AiCompareProductDto,
  AiCompareResultDto,
  AiCompareRowDto,
} from './dto/ai-compare.dto';

const MAX_ROWS = 14;
const MAX_POINTS = 4;

const COMPONENT_MAX = 48;
const VALUE_MAX = 160;
const NOTE_MAX = 160;
const POINT_MAX = 140;
const SUMMARY_MAX = 700;
const VERDICT_MAX = 700;

const EMPTY_VALUE = '—';

export interface ComparedProduct {
  id: number;
  name: string;
}

export function parseAiCompare(
  raw: string | null | undefined,
  products: ComparedProduct[],
): AiCompareResultDto | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw ?? '') as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const rows = readRows(parsed.rows, products);
  const summary = text(parsed.summary, SUMMARY_MAX);

  if (!summary && rows.length === 0) return null;

  return {
    comparable: parsed.comparable !== false,
    summary,
    rows,
    products: readProducts(parsed.products, products),
    verdict: readVerdict(parsed.verdict, products),
  };
}

function readRows(
  raw: unknown,
  products: ComparedProduct[],
): AiCompareRowDto[] {
  if (!Array.isArray(raw)) return [];

  const rows: AiCompareRowDto[] = [];
  for (const item of raw) {
    if (rows.length >= MAX_ROWS) break;
    if (!item || typeof item !== 'object') continue;

    const row = item as Record<string, unknown>;
    const component = text(row.component, COMPONENT_MAX);
    if (!component) continue;

    const values = products.map((_, i) => {
      const list = Array.isArray(row.values) ? row.values : [];
      return text(list[i], VALUE_MAX) || EMPTY_VALUE;
    });

    if (values.every((v) => v === EMPTY_VALUE)) continue;

    rows.push({
      component,
      values,
      bestId: productId(row.best, products),
      note: text(row.note, NOTE_MAX),
    });
  }
  return rows;
}

function readProducts(
  raw: unknown,
  products: ComparedProduct[],
): AiCompareProductDto[] {
  const byIndex = new Map<number, Record<string, unknown>>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const index = wholeNumber(entry.index);
      if (index === null || index < 0 || index >= products.length) continue;
      if (!byIndex.has(index)) byIndex.set(index, entry);
    }
  }

  return products.map((product, i) => {
    const entry = byIndex.get(i);
    return {
      id: product.id,
      name: product.name,
      pros: points(entry?.pros),
      cons: points(entry?.cons),
      bestFor: text(entry?.bestFor, POINT_MAX),
    };
  });
}

function readVerdict(raw: unknown, products: ComparedProduct[]) {
  const verdict = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    bestId: productId(verdict.best, products),
    valueId: productId(verdict.value, products),
    text: text(verdict.text, VERDICT_MAX),
  };
}

function points(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => text(item, POINT_MAX))
    .filter(Boolean)
    .slice(0, MAX_POINTS);
}

function productId(raw: unknown, products: ComparedProduct[]): number | null {
  const index = wholeNumber(raw);
  if (index === null || index < 0 || index >= products.length) return null;
  return products[index].id;
}

function wholeNumber(raw: unknown): number | null {
  const value = typeof raw === 'string' ? Number(raw.trim()) : raw;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function text(raw: unknown, max: number): string {
  if (typeof raw === 'number') return String(raw);
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, max);
}
