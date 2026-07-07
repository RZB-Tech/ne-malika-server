import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { S3Client } from '@aws-sdk/client-s3';
import { S3_CLIENT } from './s3-client.provider';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';
import { MAX_FILE_SIZE_BYTES, PRESIGNED_URL_TTL_SEC } from './files.constants';

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

  buildPublicUrl(key: string): string {
    const base = this.configService.get<string>('s3.publicBase')!;
    return `${base.replace(/\/$/, '')}/${key}`;
  }
}
