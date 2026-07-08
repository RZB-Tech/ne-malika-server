import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const apiPrefix = config.get<string>('apiPrefix')!;

  app.setGlobalPrefix(apiPrefix);
  app.use(cookieParser());
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('НеМалика API')
    .setDescription(
      'Маркетплейс компьютерной техники — REST API для веб-витрины (Next.js) и Telegram mini-app. ' +
        'Покупатель работает без авторизации; продавец и администратор авторизуются через Telegram initData.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access-токен, полученный из POST /auth/telegram или /auth/refresh',
      },
      'access-token', // имя схемы — используем как ссылку в @ApiBearerAuth('access-token')
    )
    .addTag(
      'auth',
      'Авторизация через Telegram initData, выпуск/обновление JWT',
    )
    .addTag(
      'bot',
      'Webhook Telegram-бота (внутренний, не для внешних клиентов)',
    )
    .addTag('shops-public', 'Публичная выдача магазинов (покупатель)')
    .addTag('shops-seller', 'Управление своими магазинами (продавец)')
    .addTag('shops-admin', 'Упразднение магазинов (администратор)')
    .addTag('product-cards-public', 'Публичная выдача товаров (покупатель)')
    .addTag('product-cards-seller', 'Управление своими товарами (продавец)')
    .addTag('product-cards-admin', 'Упразднение товаров (администратор)')
    .addTag('files', 'Загрузка и получение файлов из S3')
    .addTag('reports', 'Жалобы покупателей и их просмотр администратором')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = config.get<number>('port')!;
  await app.listen(port);
  console.log(`НеМалика backend running on port ${port}`);
  console.log(`Swagger UI: http://localhost:${port}/${apiPrefix}/docs`);
}
bootstrap();
