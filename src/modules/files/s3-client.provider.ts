import { Agent } from 'https';
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';

export const S3_CLIENT = Symbol('S3_CLIENT');

const CONNECTION_TIMEOUT_MS = 3_000;
const REQUEST_TIMEOUT_MS = 15_000;

const MAX_ATTEMPTS = 2;

const httpsAgent = new Agent({
  keepAlive: true,
  keepAliveMsecs: 15_000,
  maxSockets: 256,
});

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
        httpsAgent,
      },
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });
  },
};
