import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CharacteristicDto } from '../../shops/dto/characteristics';

/**
 * Сколько фотографий уходит в модель.
 *
 * Больше, чем у ИИ-проверки с её единственным кадром, и намеренно: та выносит
 * вердикт «товар это или мусор», для чего хватает одного снимка, а здесь надо
 * прочитать надписи на корпусе, разъёмы с торца и комплектацию рядом — они
 * почти никогда не помещаются в один кадр. Три снимка в `detail: low` стоят
 * около $0.001, то есть десятую часть прайса, — на цену для продавца это не
 * влияет, а полнота характеристик заметно растёт.
 */
export const AUTOFILL_MAX_PHOTOS = 3;

/** Столько символов описания принимаем на вход и отдаём обратно. */
export const AUTOFILL_DESCRIPTION_MAX = 2000;

/**
 * Предел на число характеристик. Схема товара разрешает пятьдесят, но это
 * потолок для продавца, заполняющего карточку руками. Модель, которой не
 * поставить границу, охотно доводит список до тридцати пунктов, разбавляя
 * известное водой вида «Тип: устройство», — и полезное в этом списке уже не
 * найти.
 */
export const AUTOFILL_MAX_CHARACTERISTICS = 15;

export class AutofillProductDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: AUTOFILL_MAX_PHOTOS,
    description:
      'Фотографии товара. Первая — главная; лишние сверх лимита отбрасываются',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AUTOFILL_MAX_PHOTOS)
  @IsUUID('4', { each: true })
  photoKeys: string[];

  @ApiProperty({
    minLength: 2,
    maxLength: 200,
    example: 'MacBook Air M2 13"',
    description:
      'Название от продавца — модель на него опирается, но не правит',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    maxLength: AUTOFILL_DESCRIPTION_MAX,
    description:
      'Уже написанное продавцом. Пустое допустимо; непустое модель обязана ' +
      'сохранить по фактам, а не заменить своим текстом',
  })
  @IsOptional()
  @IsString()
  @MaxLength(AUTOFILL_DESCRIPTION_MAX)
  description?: string;

  @ApiPropertyOptional({
    type: [CharacteristicDto],
    description:
      'Характеристики, заполненные продавцом: модель их не выбрасывает, ' +
      'а дополняет и приводит к единому виду',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CharacteristicDto)
  characteristics?: CharacteristicDto[];

  @ApiPropertyOptional({
    example: 12,
    description:
      'Категория, уже выбранная продавцом. Подсказывает модели, что перед ней ' +
      'за товар, а для раздела услуг ещё и меняет правила заполнения',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({
    enum: ['new', 'old'],
    description: 'Состояние, выбранное продавцом. Слово продавца тут последнее',
  })
  @IsOptional()
  @IsIn(['new', 'old'])
  state?: 'new' | 'old';
}

export class AutofilledProductDto {
  @ApiProperty({
    description:
      'Готовое описание в том же ограниченном markdown, что и витрина',
  })
  description: string;

  @ApiProperty({
    type: [CharacteristicDto],
    description:
      'Характеристики без бренда и модели: для них есть отдельные поля ответа',
  })
  characteristics: CharacteristicDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Apple',
    description: 'null — на фото не видно и продавец не назвал',
  })
  brand: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'MacBook Air M2',
    description: 'null — определить не удалось',
  })
  model: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 12,
    description:
      'Предложенный раздел каталога. Всегда из доступных магазину; ' +
      'null — подходящего не нашлось',
  })
  categoryId: number | null;

  @ApiProperty({
    enum: ['new', 'old'],
    nullable: true,
    description: 'null — по фотографиям и тексту состояние не определить',
  })
  state: 'new' | 'old' | null;

  @ApiProperty({
    example: 10,
    description:
      'Списано с магазина. 0 у администратора — за него платит площадка',
  })
  credits: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 290,
    description:
      'Остаток после списания — чтобы форма обновила счётчик без второго ' +
      'запроса. null у администратора: у него лимита нет',
  })
  balance: number | null;
}

export class AutofillPriceDto {
  @ApiProperty({
    example: 10,
    description: 'Цена одного автозаполнения в кредитах',
  })
  price: number;

  @ApiProperty({
    description: 'Хватает ли кредитов. У администратора всегда true',
  })
  allowed: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 300,
    description: 'Доступный остаток. null — без ограничения (администратор)',
  })
  balance: number | null;
}
