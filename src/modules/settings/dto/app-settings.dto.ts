import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class AppSettingsDto {
  @ApiProperty({
    description:
      'Автоматическая ИИ-проверка товаров при создании и редактировании',
    example: true,
  })
  @IsBoolean()
  aiChecksEnabled: boolean;
}
