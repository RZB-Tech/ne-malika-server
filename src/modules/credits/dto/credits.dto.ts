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
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';

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
  @ApiProperty({ description: 'Купленные и подаренные кредиты. Не сгорают' })
  balance: number;

  @ApiProperty({ description: 'Занято выполняющимися сейчас запросами' })
  reserved: number;

  @ApiProperty({ description: 'Доступно к трате' })
  available: number;
}

export class SellerCreditsDto extends ShopCreditsDto {
  @ApiProperty({
    description:
      'Кредиты подписки как они лежат в магазине — включая запертые ' +
      'истёкшим тарифом: оплатив снова, продавец получит норму заново',
  })
  subscription: number;

  @ApiProperty({
    description:
      'Из них доступны к трате сейчас. Ноль, если подписка истекла: ' +
      'кредиты не сгорели, но и потратить их нельзя',
  })
  usable: number;
}

export class CreditTxnMetaDto {
  @ApiPropertyOptional({
    enum: ['prompt', 'description', 'image', 'autofill'],
    description: 'За что списано',
  })
  operation?: 'prompt' | 'description' | 'image' | 'autofill';

  @ApiPropertyOptional({ description: 'Сколько картинок нарисовано' })
  images?: number;

  @ApiPropertyOptional({
    enum: ['welcome', 'welcome_topup', 'subscription', 'subscription_burn'],
    description:
      'Метка выдачи: подарок, выдача нормы подписки или сгорание остатка',
  })
  promo?: 'welcome' | 'welcome_topup' | 'subscription' | 'subscription_burn';

  @ApiPropertyOptional({
    enum: ['start', 'pro', 'max'],
    description: 'Тариф, по которому выдано или сожжено',
  })
  plan?: 'start' | 'pro' | 'max';

  @ApiPropertyOptional({
    description: 'Сколько из списания ушло с подписочного счёта',
  })
  fromSubscription?: number;

  @ApiPropertyOptional({
    enum: ['quota', 'unlimited'],
    description: 'Автозаполнение прошло по месячной норме либо по безлимиту',
  })
  free?: 'quota' | 'unlimited';

  @ApiPropertyOptional({
    description: 'Списано по объявленному прайсу, а не по стоимости запроса',
  })
  fixed?: boolean;

  @ApiPropertyOptional({ description: 'Платёж, породивший выдачу' })
  paymentId?: number;
}

export class CreditTxnDto {
  @ApiProperty()
  id: number;

  @ApiProperty({
    enum: ['grant', 'spend', 'refund', 'adjust'],
    description:
      'grant — начисление, spend — списание за запрос, adjust — правка ' +
      'человеком либо сгорание подписочного остатка',
  })
  kind: 'grant' | 'spend' | 'refund' | 'adjust';

  @ApiProperty({
    description: 'Со знаком: выдача положительна, списание — нет',
  })
  amount: number;

  @ApiProperty({ description: 'Купленный остаток после операции' })
  balanceAfter: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Подписочный остаток после операции. null у строк, написанных до ' +
      'появления подписок — историю задним числом не переписываем',
  })
  subscriptionAfter: number | null;

  @ApiProperty({ type: String, nullable: true })
  note: string | null;

  @ApiProperty({ type: CreditTxnMetaDto, nullable: true })
  meta: CreditTxnMetaDto | null;

  @ApiProperty()
  createdAt: Date;
}

export class PaginatedCreditsHistoryDto {
  @ApiProperty({ type: [CreditTxnDto] })
  data: CreditTxnDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
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
