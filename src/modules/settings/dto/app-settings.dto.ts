import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class AppSettingsDto {
  @ApiProperty({
    description:
      'Автоматическая ИИ-проверка товаров при создании и редактировании',
    example: true,
  })
  @IsBoolean()
  aiChecksEnabled: boolean;

  @ApiPropertyOptional({
    description:
      'Множитель наценки на кредиты: сумма от магазина делится на него. ' +
      'При 2 оплата $20 даёт $10 доступного расхода.',
    minimum: 1,
    maximum: 100,
    example: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  creditMarkup?: number;
}
