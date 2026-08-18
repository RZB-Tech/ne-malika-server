import { ApiProperty } from '@nestjs/swagger';

export class ActivityPointDto {
  @ApiProperty({ description: 'Сутки, YYYY-MM-DD', example: '2026-08-18' })
  date: string;

  @ApiProperty({ description: 'Добавлено товаров', example: 17 })
  products: number;

  @ApiProperty({ description: 'Создано магазинов', example: 2 })
  shops: number;

  @ApiProperty({ description: 'Зарегистрировано пользователей', example: 34 })
  users: number;

  @ApiProperty({ description: 'Просмотров карточек', example: 1204 })
  views: number;

  @ApiProperty({
    description: 'Контактов с продавцами: телефон + Telegram',
    example: 96,
  })
  contacts: number;
}

export class AdminActivityDto {
  @ApiProperty({
    description: 'Ряд по дням от старого к новому, без пропусков',
    type: [ActivityPointDto],
  })
  daily: ActivityPointDto[];

  @ApiProperty({ description: 'Итого товаров за период', example: 312 })
  productsTotal: number;

  @ApiProperty({ description: 'Итого магазинов за период', example: 14 })
  shopsTotal: number;

  @ApiProperty({ description: 'Итого пользователей за период', example: 508 })
  usersTotal: number;

  @ApiProperty({ description: 'Итого просмотров за период', example: 24310 })
  viewsTotal: number;

  @ApiProperty({ description: 'Итого контактов за период', example: 1877 })
  contactsTotal: number;
}
