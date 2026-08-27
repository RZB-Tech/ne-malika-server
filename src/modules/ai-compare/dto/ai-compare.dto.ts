import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';

export const AI_COMPARE_MIN = 2;

export const AI_COMPARE_MAX = 4;

export class AiCompareQueryDto {
  @ApiProperty({
    description:
      'id товаров через запятую, от 2 до 4. Порядок задаёт порядок столбцов в ответе.',
    example: '10,12,15',
  })
  @Transform(({ value }: { value: unknown }) =>
    String(value)
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v) && v > 0),
  )
  @IsArray()
  @ArrayMinSize(AI_COMPARE_MIN)
  @ArrayMaxSize(AI_COMPARE_MAX)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids: number[];
}

export class AiCompareRowDto {
  @ApiProperty({
    description: 'Составляющая: «Процессор», «Видеокарта», «Экран»…',
    example: 'Процессор',
  })
  component: string;

  @ApiProperty({
    type: [String],
    description:
      'Значение у каждого товара, в порядке products. «—» — продавец не указал.',
    example: ['Ryzen 5 5600', 'Core i5-11400F'],
  })
  values: string[];

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'id товара с лучшим значением. null — ничья или сравнивать нечего.',
    example: 10,
  })
  bestId: number | null;

  @ApiProperty({ description: 'Чем лучше — одним предложением', example: '' })
  note: string;
}

export class AiCompareProductDto {
  @ApiProperty({ example: 10 })
  id: number;

  @ApiProperty({ example: 'Игровой ПК Ryzen 5' })
  name: string;

  @ApiProperty({ type: [String] })
  pros: string[];

  @ApiProperty({ type: [String] })
  cons: string[];

  @ApiProperty({
    description: 'Кому этот товар подойдёт',
    example: 'Игры в 1080p и монтаж дома',
  })
  bestFor: string;
}

export class AiCompareVerdictDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'id товара, который лучше по железу',
  })
  bestId: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'id товара, который выгоднее за свои деньги',
  })
  valueId: number | null;

  @ApiProperty({ description: 'Итог одним абзацем' })
  text: string;
}

export class AiCompareResultDto {
  @ApiProperty({
    description:
      'Сравнимы ли товары по железу. false — это разные виды техники, и таблица составляющих будет пустой',
  })
  comparable: boolean;

  @ApiProperty({ description: 'Общий вывод в 2–3 предложениях' })
  summary: string;

  @ApiProperty({ type: [AiCompareRowDto] })
  rows: AiCompareRowDto[];

  @ApiProperty({ type: [AiCompareProductDto] })
  products: AiCompareProductDto[];

  @ApiProperty({ type: AiCompareVerdictDto })
  verdict: AiCompareVerdictDto;

  @ApiPropertyOptional({
    description:
      'Ответ отдан из кэша: те же товары уже сравнивали, к модели не ходили',
  })
  cached?: boolean;
}
