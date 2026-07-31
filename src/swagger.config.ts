import { DocumentBuilder } from '@nestjs/swagger';

/** Общий для рантайма (`/docs`) и для скрипта выгрузки спеки (`gen:openapi`). */
export const swaggerConfig = new DocumentBuilder()
  .setTitle('НеМалика API')
  .setDescription(
    'Маркетплейс компьютерной техники — REST API для веб-витрины (Next.js) и Telegram mini-app. ' +
      'Покупатель работает без авторизации; продавец и администратор авторизуются через Telegram.',
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
  .addTag('files', 'Загрузка и получение файлов из S3')
  .addTag('reports', 'Жалобы покупателей и их просмотр администратором')
  .build();
