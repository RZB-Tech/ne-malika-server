import type {
  ShopDailyPointDto,
  TopProductDto,
} from './dto/shop-analytics.dto';

const SEP = ';';

const EOL = '\r\n';

const BOM = '\uFEFF';

export type AnalyticsCsvProduct = Omit<TopProductDto, 'id'>;

export type AnalyticsCsvDay = ShopDailyPointDto;

export interface AnalyticsCsvInput {
  shopName: string;
  from: string;
  to: string;
  daily: AnalyticsCsvDay[];
  topProducts: AnalyticsCsvProduct[];
}

export function buildAnalyticsCsv(input: AnalyticsCsvInput): string {
  const lines: string[] = [
    row(['Магазин', input.shopName]),
    row(['Период', `${input.from} — ${input.to}`]),
    '',
    row(['По дням']),
    row([
      'Дата',
      'Просмотры',
      'Посетители',
      'Раскрытий телефона',
      'Переходов в Telegram',
      'Дошли до контакта',
    ]),
    ...input.daily.map((day) =>
      row([
        day.date,
        day.views,
        day.visitors,
        day.phoneClicks,
        day.telegramClicks,
        day.contactVisitors,
      ]),
    ),
    '',
    row(['Топ товаров']),
    row([
      'Товар',
      'Просмотры',
      'Посещения',
      'Контакты',
      'Дошли до контакта',
      'Конверсия, %',
    ]),
    ...input.topProducts.map((product) =>
      row([
        product.name,
        product.views,
        product.visits,
        product.contacts,
        product.contactVisitors,
        product.conversionPercent,
      ]),
    ),
  ];

  return BOM + lines.join(EOL) + EOL;
}

function row(cells: (string | number)[]): string {
  return cells.map(cell).join(SEP);
}

function cell(value: string | number): string {
  const text =
    typeof value === 'number' ? String(value) : value.replace(/\r\n?/g, '\n');

  return `"${text.replace(/"/g, '""')}"`;
}
