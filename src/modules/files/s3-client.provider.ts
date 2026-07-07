import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';

export const S3_CLIENT = Symbol('S3_CLIENT');

export const s3ClientProvider: Provider = {
  provide: S3_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    return new S3Client({
      region: config.get<string>('s3.region'),
      endpoint: config.get<string>('s3.endpoint') || undefined,
      // forcePathStyle нужен для S3-совместимых хранилищ (MinIO, DigitalOcean Spaces
      // и т.п.), где бакет — часть пути, а не поддомена. Для настоящего AWS S3 не мешает.
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get<string>('s3.accessKey')!,
        secretAccessKey: config.get<string>('s3.secretKey')!,
      },
    });
  },
};
