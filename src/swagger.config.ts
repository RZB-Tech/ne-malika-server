import { DocumentBuilder } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
  .setTitle('НеМалика API')
  .setDescription(
    'Маркетплейс компьютерной техники — REST API для веб-витрины (Next.js) и Telegram mini-app. ' +
      'Покупать можно без авторизации; вход через Telegram нужен продавцу, администратору ' +
      'и покупателю, который хочет видеть историю просмотров на всех своих устройствах.',
  )
  .setVersion('1.0.0')
  .addBearerAuth(
    {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Access-токен из POST /auth/telegram или /auth/refresh',
    },
    'access-token',
  )
  .addTag('auth', 'Авторизация через Telegram, выпуск/обновление JWT')
  .addTag('shops-public', 'Публичная выдача магазинов (покупатель)')
  .addTag('shops-seller', 'Управление своими магазинами (продавец)')
  .addTag('shops-admin', 'Упразднение магазинов (администратор)')
  .addTag('product-cards-public', 'Публичная выдача товаров (покупатель)')
  .addTag('product-cards-seller', 'Управление своими товарами (продавец)')
  .addTag(
    'product-cards-admin',
    'Упразднение и обслуживание товаров (администратор)',
  )
  .addTag(
    'me-product-views',
    'Личный кабинет покупателя: история просмотренных товаров',
  )
  .addTag('me-favorites', 'Личный кабинет покупателя: избранные товары')
  .addTag('files', 'Загрузка и получение файлов из S3')
  .addTag('reports', 'Жалобы покупателей и их просмотр администратором')
  .addTag('subscriptions-public', 'Тарифы подписки магазина и их цены')
  .addTag(
    'subscriptions-seller',
    'Подписка продавца: состояние, оплата, история платежей',
  )
  .addTag(
    'subscriptions-admin',
    'Подписки магазинов: список, ручная выдача и отмена (администратор)',
  )
  .addTag('credits-seller', 'Кредиты магазина на ИИ и их журнал (продавец)')
  .addTag('banners-public', 'Карусель баннеров на главной (покупатель)')
  .addTag('banners-seller', 'Баннер магазина в карусели главной (тариф MAX)')
  .addTag(
    'banners-admin',
    'Баннеры площадки и модерация баннеров магазинов (администратор)',
  )
  .addTag(
    'shop-analytics-seller',
    'Аналитика магазина: сводка, поисковые запросы, выгрузка CSV (продавец)',
  )
  .build();
