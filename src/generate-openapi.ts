/**
 * Выгружает OpenAPI-спеку в файл без запуска сервера и без подключения к БД.
 * Нужен, чтобы клиентская спека (ne-malika-client/openapi/nemalika.json) не
 * расходилась с кодом: `pnpm gen:openapi` → скопировать → `pnpm gen:api` на клиенте.
 *
 *   pnpm gen:openapi [путь]     по умолчанию openapi/nemalika.json
 */
import { writeFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { swaggerConfig } from './swagger.config';

async function main() {
  // Внешние подключения при генерации спеки не нужны и мешают процессу
  // завершиться: вебхук бота регистрируется в onModuleInit, а клиент Redis
  // после закрытия приложения продолжает переподключаться.
  delete process.env.TELEGRAM_WEBHOOK_URL;
  delete process.env.REDIS_URL;

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix(process.env.API_PREFIX ?? 'api/v1');
  await app.init();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  const out = resolve(process.argv[2] ?? 'openapi/nemalika.json');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();

  console.log(`OpenAPI записан в ${out}`);
  process.exit(0);
}

void main();
