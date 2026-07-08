import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import {
  GetObjectCommand,
  GetObjectCommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { S3_CLIENT } from './s3-client.provider';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';
import { MAX_FILE_SIZE_BYTES, PRESIGNED_URL_TTL_SEC } from './files.constants';

type S3FileBody = NonNullable<GetObjectCommandOutput['Body']>;

export interface S3File {
  body: Readable;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
  cacheControl?: string;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Генерирует presigned POST для прямой загрузки в S3.
   * Ключ — чистый uuid v4 без расширения (раздел 8), совместим с колонками
   * shops.photo (uuid) и product_cards.photos (uuid[]) без изменений схемы.
   *
   * Content-Type фиксируется в самой presigned-политике (Fields + Conditions),
   * поэтому S3 сохраняет его как метаданные объекта и отдаёт тем же
   * заголовком при GET — расширение в ключе для этого не требуется.
   */
  async createUploadUrl(
    dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponseDto> {
    const bucket = this.configService.get<string>('s3.bucket')!;
    const key = randomUUID();

    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 0, MAX_FILE_SIZE_BYTES],
        ['eq', '$Content-Type', dto.contentType],
      ],
      Fields: {
        'Content-Type': dto.contentType,
      },
      Expires: PRESIGNED_URL_TTL_SEC,
    });

    this.logger.debug(`Выдана presigned-ссылка для ключа ${key}`);

    return {
      key,
      publicUrl: this.buildPublicUrl(key),
      uploadUrl: url,
      fields,
      expiresInSec: PRESIGNED_URL_TTL_SEC,
    };
  }

  async getFile(key: string): Promise<S3File> {
    const bucket = this.configService.get<string>('s3.bucket')!;

    try {
      const object = await this.s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      if (!object.Body) {
        throw new NotFoundException('Файл не найден');
      }

      return {
        body: await this.toReadable(object.Body),
        contentType: object.ContentType,
        contentLength: object.ContentLength,
        etag: object.ETag,
        lastModified: object.LastModified,
        cacheControl: object.CacheControl,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      if (this.isS3NotFound(error)) {
        throw new NotFoundException('Файл не найден');
      }

      this.logger.error(
        `Не удалось получить файл ${key} из S3`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException('Не удалось получить файл из S3');
    }
  }

  buildPublicUrl(key: string): string {
    const base = this.configService.get<string>('s3.publicBase')!;
    return `${base.replace(/\/$/, '')}/${key}`;
  }

  private async toReadable(body: S3FileBody): Promise<Readable> {
    if (body instanceof Readable) {
      return body;
    }

    const sdkBody = body as {
      transformToByteArray?: () => Promise<Uint8Array>;
    };

    if (typeof sdkBody.transformToByteArray === 'function') {
      const bytes = await sdkBody.transformToByteArray();
      return Readable.from([Buffer.from(bytes)]);
    }

    return Readable.from(body as AsyncIterable<Uint8Array>);
  }

  private isS3NotFound(error: unknown): boolean {
    const s3Error = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };

    return (
      s3Error.$metadata?.httpStatusCode === 404 ||
      s3Error.name === 'NoSuchKey' ||
      s3Error.name === 'NotFound'
    );
  }
}
