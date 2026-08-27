const MAX_TERMS = 8;

const MAX_TERM_LENGTH = 40;

const MIN_LIKE_LENGTH = 3;

const MAX_LIKE_LENGTH = 100;

const TO_CYRILLIC: [string, string][] = [
  ['shch', 'щ'],
  ['sch', 'щ'],
  ['yo', 'ё'],
  ['yu', 'ю'],
  ['ya', 'я'],
  ['zh', 'ж'],
  ['ch', 'ч'],
  ['sh', 'ш'],
  ['kh', 'х'],
  ['ts', 'ц'],
  ['a', 'а'],
  ['b', 'б'],
  ['c', 'к'],
  ['d', 'д'],
  ['e', 'е'],
  ['f', 'ф'],
  ['g', 'г'],
  ['h', 'х'],
  ['i', 'и'],
  ['j', 'ж'],
  ['k', 'к'],
  ['l', 'л'],
  ['m', 'м'],
  ['n', 'н'],
  ['o', 'о'],
  ['p', 'п'],
  ['q', 'к'],
  ['r', 'р'],
  ['s', 'с'],
  ['t', 'т'],
  ['u', 'у'],
  ['v', 'в'],
  ['w', 'в'],
  ['x', 'х'],
  ['y', 'й'],
  ['z', 'з'],
];

const TO_LATIN: [string, string][] = [
  ['а', 'a'],
  ['б', 'b'],
  ['в', 'v'],
  ['г', 'g'],
  ['ғ', 'g'],
  ['д', 'd'],
  ['е', 'e'],
  ['ё', 'yo'],
  ['ж', 'j'],
  ['з', 'z'],
  ['и', 'i'],
  ['й', 'y'],
  ['к', 'k'],
  ['қ', 'q'],
  ['л', 'l'],
  ['м', 'm'],
  ['н', 'n'],
  ['о', 'o'],
  ['ў', 'o'],
  ['п', 'p'],
  ['р', 'r'],
  ['с', 's'],
  ['т', 't'],
  ['у', 'u'],
  ['ф', 'f'],
  ['х', 'h'],
  ['ҳ', 'h'],
  ['ц', 'ts'],
  ['ч', 'ch'],
  ['ш', 'sh'],
  ['щ', 'sh'],
  ['ъ', ''],
  ['ы', 'i'],
  ['ь', ''],
  ['э', 'e'],
  ['ю', 'yu'],
  ['я', 'ya'],
];

export interface ProductSearch {
  queries: string[];
  like: string | null;
}

export function buildProductSearch(raw: string): ProductSearch | null {
  const terms = tokenize(raw);
  if (terms.length === 0) return null;

  const queries = unique([
    toTsQuery(terms),
    toTsQuery(terms.map(transliterate(TO_CYRILLIC))),
    toTsQuery(terms.map(transliterate(TO_LATIN))),
  ]);

  const trimmed = raw.trim();
  const like =
    trimmed.length >= MIN_LIKE_LENGTH && trimmed.length <= MAX_LIKE_LENGTH
      ? `%${escapeLike(trimmed)}%`
      : null;

  return { queries, like };
}

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_TERMS)
    .map((term) => term.slice(0, MAX_TERM_LENGTH));
}

function toTsQuery(terms: string[]): string {
  return terms.map((term) => `${term}:*`).join(' & ');
}

function transliterate(table: [string, string][]) {
  return (term: string): string => {
    let rest = term;
    let out = '';
    outer: while (rest.length > 0) {
      for (const [from, to] of table) {
        if (rest.startsWith(from)) {
          out += to;
          rest = rest.slice(from.length);
          continue outer;
        }
      }
      out += rest[0];
      rest = rest.slice(1);
    }
    return out;
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
