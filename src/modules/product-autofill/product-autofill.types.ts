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

function parseCharacteristics(value: unknown): ProductCharacteristic[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const result: ProductCharacteristic[] = [];

  for (const item of value) {
    if (result.length >= AUTOFILL_MAX_CHARACTERISTICS) break;
    const raw = item as { key?: unknown; value?: unknown };
    const key = text(raw?.key, KEY_MAX).replace(/:$/, '').trim();
    const characteristicValue = text(raw?.value, VALUE_MAX);
    if (!key || !characteristicValue) continue;

    const normalized = normalizeKey(key);
    if (seen.has(normalized)) continue;
    if (BRAND_KEYS.has(normalized) || MODEL_KEYS.has(normalized)) continue;
    if (REJECTED_KEYS.has(normalized)) continue;

    seen.add(normalized);
    result.push({ key, value: characteristicValue });
  }

  return result;
}

export function parseAutofillResult(
  raw: string | null | undefined,
  allowedCategoryIds: ReadonlySet<number>,
): AutofillResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(unfence(raw ?? '')) as Record<string, unknown>;
  } catch {
    throw new Error('не удалось разобрать JSON-ответ модели');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('модель вернула не объект');
  }

  const description = text(parsed.description, AUTOFILL_DESCRIPTION_MAX);
  const characteristics = parseCharacteristics(parsed.characteristics);
  const brand = optionalText(parsed.brand, BRAND_MAX);
  const model = optionalText(parsed.model, BRAND_MAX);

  if (!description && characteristics.length === 0 && !brand && !model) {
    throw new Error('модель не заполнила ни одного поля');
  }

  const rawCategoryId = Number(parsed.categoryId);
  const categoryId =
    Number.isInteger(rawCategoryId) && allowedCategoryIds.has(rawCategoryId)
      ? rawCategoryId
      : null;

  const state =
    parsed.state === 'new' || parsed.state === 'old' ? parsed.state : null;

  return { description, characteristics, brand, model, categoryId, state };
}
