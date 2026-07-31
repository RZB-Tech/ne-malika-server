import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { swaggerConfig } from './swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const apiPrefix = config.get<string>('apiPrefix')!;
  const isProd = config.get<string>('env') === 'production';
  const corsOrigins = config.get<string[]>('corsOrigins')!;

  app.setGlobalPrefix(apiPrefix);
  app.use(cookieParser());
  // Вне прода список может быть пуст — тогда отражаем любой origin, чтобы не
  // мешать локальной разработке и туннелям. В проде список обязателен (env.validation).
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

  // Документация описывает и приватные эндпоинты, поэтому в проде не публикуется.
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
