import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { I18nExceptionFilter } from './common/filters/i18n-exception.filter';
import { CLICK_UNVERSIONED_CALLBACK_ROUTES } from './modules/subscriptions/click-routes';
import { swaggerConfig } from './swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const apiPrefix = config.get<string>('apiPrefix')!;
  const isProd = config.get<string>('env') === 'production';
  const corsOrigins = config.get<string[]>('corsOrigins')!;

  /**
   * Обычный REST API остаётся под `api/v1`. Для Click дополнительно открыты
   * точные unversioned-пути двух рабочих интеграций: `/api/click/callback` из
   * save-up и `/api/subscriptions/click/{prepare,complete}` из billiard_booking.
   *
   * Без исключения Nest добавил бы к ним ещё `api/v1`, и адрес, уже записанный
   * в кабинете поставщика, получил бы 404. Click показывает такой 404 как
   * «Недостаточно информации от поставщика», хотя сама подпись исправна.
   */
  app.setGlobalPrefix(apiPrefix, {
    exclude: CLICK_UNVERSIONED_CALLBACK_ROUTES,
  });
  app.use(cookieParser());
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : !isProd,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new I18nExceptionFilter());

  if (!isProd) {
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = config.get<number>('port')!;
  await app.listen(port);
  logger.log(`НеМалика backend слушает порт ${port}`);
  if (!isProd) {
    logger.log(`Swagger UI: http://localhost:${port}/${apiPrefix}/docs`);
  }
}
void bootstrap();
