import type { ProductCharacteristic } from '../../db/schema';
import {
  AUTOFILL_DESCRIPTION_MAX,
  AUTOFILL_MAX_CHARACTERISTICS,
} from './dto/product-autofill.dto';

export interface AutofillCategory {
  id: number;
  label: string;
}

export interface AutofillResult {
  description: string;
  characteristics: ProductCharacteristic[];
  brand: string | null;
  model: string | null;
  categoryId: number | null;
  state: 'new' | 'old' | null;
}

const KEY_MAX = 100;
const VALUE_MAX = 500;
const BRAND_MAX = 100;

const BRAND_KEYS = new Set([
  'бренд',
  'брэнд',
  'марка',
  'производитель',
  'brand',
  'ishlabchiqaruvchi',
  'brend',
]);
const MODEL_KEYS = new Set(['модель', 'model', 'modeli']);

const REJECTED_KEYS = new Set([
  'цена',
  'стоимость',
  'price',
  'narx',
  'narxi',
  'состояние',
  'state',
  'holati',
  'телефон',
  'контакты',
  'телеграм',
  'telegram',
  'доставка',
  'гарантия',
]);

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[\s._-]+/g, '')
    .replace(/:$/, '');
}

function unfence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optionalText(value: unknown, max: number): string | null {
  const result = text(value, max);
  if (!result || /^(?:null|none|неизвестно|не определено|—|-)$/i.test(result)) {
    return null;
  }
  return result;
}

function characteristicEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(
      ([key, entry]) => ({ key, value: entry }),
    );
  }
  return [];
}

function characteristicValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === 'string' || typeof item === 'number')
      .map((item) => String(item).trim())
      .filter(Boolean)
      .join(', ')
      .slice(0, VALUE_MAX);
  }
  return text(value, VALUE_MAX);
}

// Only labelled list items, not prose or specifications guessed from a model name.
function descriptionCharacteristics(
  description: string,
): ProductCharacteristic[] {
  return description.split('\n').flatMap((line) => {
    if (!/^\s*(?:[-*•]\s+|\*\*)/.test(line)) return [];
    const plain = line
      .trim()
      .replace(/^[-*•]\s+/, '')
      .replace(/\*\*/g, '');
    const match = /^([^:]{2,100}):\s*(.+)$/.exec(plain);
    return match ? [{ key: match[1], value: match[2] }] : [];
  });
}

function parseCharacteristics(value: unknown): ProductCharacteristic[] {
  const seen = new Set<string>();
  const result: ProductCharacteristic[] = [];

  for (const item of characteristicEntries(value)) {
    if (result.length >= AUTOFILL_MAX_CHARACTERISTICS) break;
    const raw = item as { key?: unknown; name?: unknown; value?: unknown };
    const key = text(raw?.key ?? raw?.name, KEY_MAX)
      .replace(/:$/, '')
      .trim();
    const entryValue = optionalText(characteristicValue(raw?.value), VALUE_MAX);
    if (!key || !entryValue) continue;

    const normalized = normalizeKey(key);
    if (seen.has(normalized)) continue;
    if (BRAND_KEYS.has(normalized) || MODEL_KEYS.has(normalized)) continue;
    if (REJECTED_KEYS.has(normalized)) continue;

    seen.add(normalized);
    result.push({ key, value: entryValue });
  }

  return result;
}

export function parseAutofillResult(
  raw: string | null | undefined,
  allowedCategoryIds: ReadonlySet<number>,
  context: {
    description?: string;
    characteristics?: ProductCharacteristic[];
  } = {},
): AutofillResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(unfence(raw ?? '')) as Record<string, unknown>;
  } catch {
    throw new Error('не удалось разобрать JSON-ответ модели');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('модель вернула не объект');
  }

  const description = text(parsed.description, AUTOFILL_DESCRIPTION_MAX);
  const generatedCharacteristics = parseCharacteristics([
    ...characteristicEntries(parsed.characteristics),
    ...descriptionCharacteristics(description),
  ]);
  const brand = optionalText(parsed.brand, BRAND_MAX);
  const model = optionalText(parsed.model, BRAND_MAX);

  if (
    !description &&
    generatedCharacteristics.length === 0 &&
    !brand &&
    !model
  ) {
    throw new Error('модель не заполнила ни одного поля');
  }

  const characteristics = parseCharacteristics([
    ...(context.characteristics ?? []),
    ...descriptionCharacteristics(context.description ?? ''),
    ...generatedCharacteristics,
  ]);

  const rawCategoryId = Number(parsed.categoryId);
  const categoryId =
    Number.isInteger(rawCategoryId) && allowedCategoryIds.has(rawCategoryId)
      ? rawCategoryId
      : null;

  const state =
    parsed.state === 'new' || parsed.state === 'old' ? parsed.state : null;

  return { description, characteristics, brand, model, categoryId, state };
}
