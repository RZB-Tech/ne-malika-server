import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FindProductCardsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Выбрать конкретные товары по id, через запятую (?ids=10,12,15). ' +
      'Нужен таблице сравнения: список товаров она держит у себя и тянет их одним запросом.',
    example: '10,12,15',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    String(value)
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v) && v > 0),
  )
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  ids?: number[];

  @ApiPropertyOptional({
    description: 'Текстовый поиск по name/description',
    example: 'ноутбук',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ minimum: 0, example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price_min?: number;

  @ApiPropertyOptional({ minimum: 0, example: 1500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price_max?: number;

  @ApiPropertyOptional({ enum: ['new', 'old'] })
  @IsOptional()
  @IsIn(['new', 'old'])
  state?: 'new' | 'old';

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shop_id?: number;

  /**
   * Фильтр по ветке каталога: указав корень, покупатель получает и товары из
   * его подкатегорий — иначе «Ноутбуки» отдавали бы пустую выдачу, ведь товары
   * лежат в листьях.
   */
  @ApiPropertyOptional({
    example: 12,
    description: 'id категории; товары подкатегорий тоже попадут в выдачу',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  category_id?: number;

  @ApiPropertyOptional({
    example: 'laptops',
    description: 'slug категории верхнего уровня — альтернатива category_id',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({
    enum: ['price_asc', 'price_desc', 'newest', 'random'],
    default: 'newest',
    description:
      'random — вперемешку: витрина не должна каждый раз открываться одними и ' +
      'теми же товарами сверху. Порядок задаёт seed.',
  })
  @IsOptional()
  @IsIn(['price_asc', 'price_desc', 'newest', 'random'])
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'random';

  /**
   * Зерно перемешивания: одно и то же зерно даёт один и тот же порядок.
   *
   * Без него `sort=random` был бы непригоден для ленты — вторая страница
   * тасовалась бы заново и повторила часть товаров первой, а часть не показала
   * бы вовсе. Клиент заводит зерно на один заход и шлёт его со всеми страницами.
   */
  @ApiPropertyOptional({
    example: 'k3f9d1a7',
    description: 'Зерно для sort=random; одно зерно — один и тот же порядок',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,32}$/)
  seed?: string;

  /**
   * Анонимная подпись браузера — тот же uuid из localStorage, которым
   * `ProductStatsController` отличает повторный заход от нового. На состав и
   * порядок выдачи не влияет вовсе: единственный её потребитель — счётчик
   * поисковых запросов, где по ней схлопываются повторы одного и того же
   * поиска (F5, возврат «назад» из карточки товара).
   *
   * Дедуплицировать по адресу вместо этого нельзя: `app.set('trust proxy')` не
   * выставлен, за nginx `req.ip` одинаков у всех, и один показ в десять минут
   * записывался бы на всю площадку разом.
   *
   * Негодное значение молча выбрасывается `@Transform`, а не отклоняется
   * валидатором. Это главная ручка каталога: ответить четырёхсотой на испорченную
   * запись в localStorage значило бы не показать покупателю товары вообще — цена,
   * несопоставимая с потерянной строкой статистики. Тем же приёмом чистит свой
   * ввод `ids` выше.
   */
  @ApiPropertyOptional({
    example: '9f1c3a54-7b2e-4c11-9a0d-2f5e8b6c1d33',
    description:
      'Анонимный id браузера (uuid из localStorage). Нужен только счётчику ' +
      'поисковых запросов, на выдачу не влияет; негодное значение игнорируется.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value)
      ? value
      : undefined,
  )
  @IsString()
  visitor_id?: string;
}
