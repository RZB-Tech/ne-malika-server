import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

/**
 * Ровно те поля, что отдаёт Telegram Login Widget. Список закрытый: подпись
 * считается по всем присланным полям, поэтому лишнее сюда попасть не должно
 * (глобальный ValidationPipe включает forbidNonWhitelisted).
 */
export class TelegramWidgetDto {
  @ApiProperty({ example: 123456789 })
  @Type(() => Number)
  @IsInt()
  id: number;

  @ApiPropertyOptional({ example: 'Иван' })
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiPropertyOptional({ example: 'Иванов' })
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional({ example: 'ivan_ivanov' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  photo_url?: string;

  @ApiProperty({ description: 'Unix-время авторизации', example: 1720000000 })
  @Type(() => Number)
  @IsInt()
  auth_date: number;

  @ApiProperty({ description: 'Подпись Telegram' })
  @IsString()
  hash: string;
}
