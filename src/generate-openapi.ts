import { writeFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { swaggerConfig } from './swagger.config';

async function main() {
  delete process.env.TELEGRAM_WEBHOOK_URL;
  delete process.env.REDIS_URL;
  process.env.SKIP_STARTUP_JOBS = '1';

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
