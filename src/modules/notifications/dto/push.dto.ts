import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PushConfigDto {
  @ApiProperty({ description: 'Настроены ли ключи VAPID на сервере' })
  enabled: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Публичный ключ VAPID — им браузер оформляет подписку',
  })
  publicKey: string | null;
}

export class PushStateDto {
  @ApiProperty({ description: 'Есть ли у пользователя хотя бы одна подписка' })
  subscribed: boolean;
}

export class SubscribePushDto {
  @ApiProperty({
    description: 'Адрес push-сервиса браузера из PushSubscription.endpoint',
  })
  @IsString()
  @MinLength(10)
  // Потолок щедрый: endpoint у разных браузеров сильно разной длины, а колонка
  // в базе text — ограничение здесь только от заведомого мусора.
  @MaxLength(2000)
  endpoint: string;

  @ApiProperty({ description: 'Ключ p256dh из PushSubscription.getKey' })
  @IsString()
  @MaxLength(255)
  p256dh: string;

  @ApiProperty({ description: 'Ключ auth из PushSubscription.getKey' })
  @IsString()
  @MaxLength(255)
  auth: string;

  @ApiPropertyOptional({
    description: 'Чтобы человек узнал своё устройство в списке подписок',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string;
}

export class UnsubscribePushDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  endpoint: string;
}
