import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class TelegramAuthDto {
  @ApiProperty({
    description: 'Строка initData из window.Telegram.WebApp.initData',
    example:
      'query_id=AAH...&user=%7B%22id%22...&auth_date=1720000000&hash=abc123...',
  })
  @IsString()
  @MinLength(1)
  initData: string;
}
