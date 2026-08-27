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
import { subscriptionPlanEnum } from '../../../db/schema';
import type { SubscriptionPlanId } from '../../subscriptions/subscriptions.constants';
import { CharacteristicDto } from '../../../common/dto/characteristic.dto';

export const AUTOFILL_MAX_PHOTOS = 3;

export const AUTOFILL_DESCRIPTION_MAX = 2000;

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
      'Списано с магазина. 0 у администратора — за него платит площадка, ' +
      'и 0 же у бесплатного автозаполнения: отличать по free',
  })
  credits: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 290,
    description:
      'Остаток после списания — чтобы форма обновила счётчик без второго ' +
      'запроса. null только у администратора: у него лимита нет. ' +
      'У бесплатного автозаполнения здесь число — просто не уменьшившееся',
  })
  balance: number | null;

  @ApiProperty({
    example: true,
    description:
      'Автозаполнение не стоило магазину кредитов: месячная норма START ' +
      'либо безлимит PRO/MAX. У администратора false — магазина, которому ' +
      'что-то досталось бесплатно, у него нет, за него платит площадка',
  })
  free: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 3,
    description:
      'Сколько бесплатных попыток осталось в этом месяце после этой. ' +
      'null — считать нечего: безлимит, платная ветка или администратор',
  })
  freeLeft: number | null;
}

export class AutofillPriceDto {
  @ApiProperty({
    example: 10,
    description:
      'Цена одного автозаполнения в кредитах — сколько оно стоит без подписки',
  })
  price: number;

  @ApiProperty({
    example: 0,
    description:
      'Сколько спишут за следующее нажатие: 0 в бесплатных ветках, ' +
      'price — в платной. Это и есть число для подписи под кнопкой',
  })
  effectivePrice: number;

  @ApiProperty({
    example: true,
    description:
      'Следующее нажатие бесплатно — по месячной норме либо по безлимиту',
  })
  free: boolean;

  @ApiProperty({
    example: false,
    description:
      'Тариф даёт автозаполнение без счётчика (PRO, MAX): показывать ' +
      '«без ограничений», а не остаток',
  })
  unlimited: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 3,
    description:
      'Остаток бесплатных попыток в этом месяце. null — счётчика нет: ' +
      'безлимитный тариф, отсутствие подписки или администратор',
  })
  freeLeft: number | null;

  @ApiProperty({
    example: 5,
    description:
      'Размер месячной нормы у тарифа, который её даёт (START). Это не ' +
      'остаток: у безлимитных тарифов и без подписки своего числа тут нет, ' +
      'а ноль превратил бы приглашение подписаться в «0 из 0»',
  })
  freeLimit: number;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date',
    example: '2026-09-01',
    description:
      'Когда обновится норма, YYYY-MM-DD по ташкентскому календарю. ' +
      'Датой, а не моментом времени: норма сбрасывается в ташкентскую ' +
      'полночь, и ISO-момент показал бы «31 августа» всякому браузеру ' +
      'западнее Ташкента. null — обновлять нечего',
  })
  resetsAt: string | null;

  @ApiProperty({
    enum: subscriptionPlanEnum.enumValues,
    example: 'start',
    description:
      'Действующий тариф. Считается по сроку подписки, а не по колонке ' +
      'магазина: после истечения в ней намеренно остаётся купленный тариф',
  })
  plan: SubscriptionPlanId;

  @ApiProperty({
    example: true,
    description:
      'Пройдёт ли следующее нажатие: бесплатно, по безлимиту или хватает ' +
      'кредитов. У администратора всегда true',
  })
  allowed: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 300,
    description:
      'Доступный остаток кредитов — оба кармана минус занятое. ' +
      'null — без ограничения (администратор)',
  })
  balance: number | null;
}
