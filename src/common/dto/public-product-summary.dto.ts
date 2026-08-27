import { ApiProperty } from '@nestjs/swagger';

export class PublicProductSummaryDto {
  @ApiProperty({ description: 'Идентификатор товара', example: 10 })
  id: number;

  @ApiProperty({ example: 1 })
  shopId: number;

  @ApiProperty({ example: 'TechnoDom' })
  shopName: string;

  @ApiProperty({ example: 'Ноутбук Lenovo IdeaPad 3' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ type: [String], description: 'Ключи файлов в S3' })
  photos: string[];

  @ApiProperty({
    example: '5400000.00',
    description: 'numeric приходит строкой',
  })
  price: string;

  @ApiProperty({ enum: ['new', 'old'] })
  state: 'new' | 'old';
}
