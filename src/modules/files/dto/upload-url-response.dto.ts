import { ApiProperty } from '@nestjs/swagger';

export class UploadUrlResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Ключ файла — сохраняется в БД как photo/photos',
  })
  key: string;

  @ApiProperty({ description: 'Публичный URL файла после загрузки' })
  publicUrl: string;

  @ApiProperty({
    description: 'URL для multipart/form-data POST-запроса загрузки',
  })
  uploadUrl: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Поля form-data, которые нужно отправить ДО поля с файлом',
  })
  fields: Record<string, string>;

  @ApiProperty({
    example: 300,
    description: 'Через сколько секунд ссылка истечёт',
  })
  expiresInSec: number;
}
