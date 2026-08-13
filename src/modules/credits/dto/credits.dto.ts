import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
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
      'Сумма, которую заплатил магазин, в долларах. Начисляется ровно она: ' +
      'наценка из настроек берётся при списании, а не при выдаче.',
    minimum: 1,
    maximum: 10000,
    example: 20,
  })
  @Type(() => Number)
  @IsNumber()
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

export class RevokeCreditsDto {
  @ApiProperty({
    description:
      'Сколько кредитов снять. Больше доступного снять нельзя — занятое ' +
      'выполняющимся сейчас запросом остаётся магазину.',
    minimum: 1,
    example: 5000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  credits: number;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Комментарий для истории: за что сняли',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class RevokeResultDto {
  @ApiProperty({ description: 'Остаток после списания' })
  balance: number;

  @ApiProperty({
    description:
      'Сколько кредитов сняли на самом деле: могло быть меньше запрошенного',
  })
  taken: number;
}
