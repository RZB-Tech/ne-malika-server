import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class PushChannelDto {
  @ApiProperty({
    description: 'Настроены ли ключи VAPID — без них канал недоступен всем',
  })
  available: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Публичный ключ VAPID — им браузер оформляет подписку',
  })
  publicKey: string | null;

  @ApiProperty({
    description: 'Подписан ли этот человек хотя бы с одного устройства',
  })
  subscribed: boolean;
}

export class TelegramChannelDto {
  @ApiProperty({ description: 'Настроен ли бот на сервере' })
  available: boolean;

  @ApiProperty({
    description:
      'Открыт ли чат с ботом. Без него писать первым Telegram не даёт',
  })
  linked: boolean;

  @ApiProperty({
    description: 'Согласен ли человек получать уведомления в Telegram',
  })
  enabled: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Готовая ссылка на бота. Собрана на сервере: username знает только он',
  })
  url: string | null;
}

export class NotificationChannelsDto {
  @ApiProperty({ type: PushChannelDto })
  push: PushChannelDto;

  @ApiProperty({ type: TelegramChannelDto })
  telegram: TelegramChannelDto;
}

export class SetTelegramNotificationsDto {
  @ApiProperty({ description: 'Включить или выключить уведомления в Telegram' })
  @IsBoolean()
  enabled: boolean;
}
