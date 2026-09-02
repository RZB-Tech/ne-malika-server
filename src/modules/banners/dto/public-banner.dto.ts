import { ApiProperty } from '@nestjs/swagger';

export class PublicBannerDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Школьный базар — выгода до 50%' })
  title: string;

  @ApiProperty({ format: 'uuid' })
  photoRu: string;

  @ApiProperty({ format: 'uuid' })
  photoUzLatn: string;

  @ApiProperty({ type: String, nullable: true, example: '/product/12' })
  linkUrl: string | null;
}
