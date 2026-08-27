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
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { S3_CLIENT } from './s3-client.provider';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';
import {
  AllowedMimeType,
  MAX_FILE_SIZE_BYTES,
  PRESIGNED_URL_TTL_SEC,
} from './files.constants';

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

  async saveBuffer(
    body: Buffer,
    contentType: AllowedMimeType,
  ): Promise<string> {
    if (body.byteLength > MAX_FILE_SIZE_BYTES) {
      throw new BadGatewayException(
        'Сгенерированное изображение слишком большое',
      );
    }
    const bucket = this.configService.get<string>('s3.bucket')!;
    const key = randomUUID();

    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    this.logger.debug(`Сохранён сгенерированный файл ${key}`);
    return key;
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

  async toDataUrl(key: string): Promise<string> {
    const file = await this.getFile(key);
    if (
      file.contentLength !== undefined &&
      file.contentLength > MAX_FILE_SIZE_BYTES
    ) {
      file.body.destroy();
      throw new BadGatewayException(
        'Изображение слишком большое для обработки',
      );
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of file.body) {
      const buffer = Buffer.from(chunk as Uint8Array);
      total += buffer.byteLength;
      if (total > MAX_FILE_SIZE_BYTES) {
        file.body.destroy();
        throw new BadGatewayException(
          'Изображение слишком большое для обработки',
        );
      }
      chunks.push(buffer);
    }
    const bytes = Buffer.concat(chunks);
    const type = sniffImageMime(bytes);
    if (!type) {
      throw new BadGatewayException(
        `Файл ${key} не является картинкой формата JPEG, PNG или WebP ` +
          `(Content-Type в S3: ${file.contentType ?? 'не указан'}) — ` +
          'модель такой файл не примет',
      );
    }
    return `data:${type};base64,${bytes.toString('base64')}`;
  }

  async exists(key: string): Promise<boolean> {
    const bucket = this.configService.get<string>('s3.bucket')!;

    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error) {
      if (this.isS3NotFound(error)) {
        return false;
      }

      this.logger.error(
        `Не удалось проверить файл ${key} в S3`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException('Не удалось проверить файл в S3');
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

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Content-Type в S3 задаёт клиент, поэтому он может врать: файл заявлен как
 * image/jpeg, а внутри HEIC с телефона или что-то ещё. Модель на таком отвечает
 * невнятным 400 от провайдера, так что формат определяем по сигнатуре файла.
 */
function sniffImageMime(
  bytes: Buffer,
): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.subarray(0, 3).equals(JPEG_MAGIC)) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
