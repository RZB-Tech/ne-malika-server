import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';

export const S3_CLIENT = Symbol('S3_CLIENT');

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
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });
  },
};
