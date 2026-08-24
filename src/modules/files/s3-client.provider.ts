import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';

export const S3_CLIENT = Symbol('S3_CLIENT');

/**
 * Сроки на поход в хранилище. Без них SDK ждёт ответа сколько угодно, и
 * недоступный S3 оборачивается не ошибкой, а вечно висящим запросом: каждое
 * фото товара идёт через нашу ручку `/files/:key`, и десяток зависших картинок
 * выбирает лимит соединений браузера к домену api — каталог перестаёт грузиться
 * целиком, хотя JSON-ручки отвечают за десятки миллисекунд.
 *
 * Быстрая ошибка лучше: на 502 у `<img>` срабатывает onError, и карточка рисует
 * плитку категории — витрина остаётся читаемой, пока хранилище чинят.
 *
 * requestTimeout считается по простою сокета, а не по всей передаче, поэтому
 * большие фото он не рвёт: пятнадцать секунд без единого байта — это уже не
 * медленный канал, а мёртвое соединение.
 */
const CONNECTION_TIMEOUT_MS = 3_000;
const REQUEST_TIMEOUT_MS = 15_000;

/** Одна повторная попытка: пережить моргнувшую сеть, но не утроить ожидание. */
const MAX_ATTEMPTS = 2;

function normalizeS3Endpoint(endpoint?: string): string | undefined {
  const value = endpoint?.trim();

  if (!value) {
    return undefined;
  }

  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export const s3ClientProvider: Provider = {
  provide: S3_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const accessKeyId = config.get<string>('s3.accessKey');
    const secretAccessKey = config.get<string>('s3.secretKey');

    return new S3Client({
      region: config.get<string>('s3.region'),
      endpoint: normalizeS3Endpoint(config.get<string>('s3.endpoint')),
      forcePathStyle: true,
      maxAttempts: MAX_ATTEMPTS,
      requestHandler: {
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        requestTimeout: REQUEST_TIMEOUT_MS,
      },
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });
  },
};
