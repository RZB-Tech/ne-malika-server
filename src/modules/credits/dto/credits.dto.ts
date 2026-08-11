import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class GrantCreditsDto {
  @ApiProperty({
    description:
      'Сумма, которую заплатил магазин, в долларах. Начислится делённой ' +
      'на множитель наценки из настроек.',
    minimum: 1,
    maximum: 10000,
    example: 20,
  })
  @Type(() => Number)
  @IsNumber()
  // Не меньше доллара: копеечные выдачи после деления на множитель дают ноль
  // кредитов, и админ решит, что кнопка не работает.
  @Min(1)
  @Max(10000)
  amountUsd: number;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Комментарий для истории: номер платежа, договорённость',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class ShopCreditsDto {
  @ApiProperty({ description: 'Начислено всего, за вычетом потраченного' })
  balance: number;

  @ApiProperty({ description: 'Занято выполняющимися сейчас запросами' })
  reserved: number;

  @ApiProperty({ description: 'Доступно к трате: balance − reserved' })
  available: number;
}

export class GrantResultDto {
  @ApiProperty()
  balance: number;

  @ApiProperty({ description: 'Сколько кредитов начислено этой выдачей' })
  credits: number;

  @ApiProperty({ description: 'Множитель, применённый при начислении' })
  markup: number;
}

export class CreditPreviewDto {
  @ApiProperty({ description: 'Сколько кредитов даст указанная сумма' })
  credits: number;

  @ApiProperty()
  markup: number;
}
