import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ALLOWED_MIME_TYPES } from '../files.constants';

export class CreateUploadUrlDto {
  @ApiProperty({
    enum: ALLOWED_MIME_TYPES,
    description: 'MIME-тип загружаемого файла',
    example: 'image/jpeg',
  })
  @IsIn(ALLOWED_MIME_TYPES)
  contentType: (typeof ALLOWED_MIME_TYPES)[number];
}
