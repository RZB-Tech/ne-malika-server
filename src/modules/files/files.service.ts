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

  /**
   * Кладёт в хранилище файл, пришедший не от браузера, а из нашего же кода —
   * сейчас это картинки от генератора. Presigned-ссылка тут не годится: она
   * рассчитана на загрузку с клиента, а байты уже у нас.
   *
   * Ключ такой же — чистый uuid, поэтому сгенерированное фото ничем не
   * отличается от загруженного и ложится в product_cards.photos как есть.
   */
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

  /**
   * Картинка байтами в data-URL — в таком виде её принимают модели. Ссылку на
   * наш S3 им давать нельзя: ходили бы за ней сами, и любая заминка у нас
   * возвращалась как «Timeout while downloading», срывая проверку и генерацию.
   */
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
    const type = file.contentType ?? 'image/jpeg';
    return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`;
  }

  /**
   * Есть ли такой объект в хранилище.
   *
   * `HeadObjectCommand`, а не `GetObjectCommand`: нужен только факт, а тело
   * баннера — мегабайты, которые пришлось бы вычитать и выбросить. Head
   * возвращает одни метаданные и стоит примерно как ничего.
   *
   * Нужен там, где ключ приходит от пользователя отдельно от загрузки: форма
   * присылает uuid, который ей вернул presigned-эндпоинт, но никакой связи
   * между этими двумя запросами нет, и `@IsUUID('4')` проверяет лишь форму
   * строки. Несуществующий ключ в баннере — битая картинка на главной
   * странице, и увидит её покупатель, а не тот, кто её прислал.
   *
   * Отсутствие файла — это `false`, а не исключение: «нет объекта» здесь
   * нормальный ответ, и решать, чем он обернётся для пользователя, обязан
   * вызывающий — у баннера и у аватарки тексты разные. А вот недоступность
   * самого S3 глотать нельзя: молчаливый `false` на упавшем хранилище
   * превратил бы аварию в «вы прислали неверный файл», и чинить пошли бы не
   * то и не там.
   */
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
