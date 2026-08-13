import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Баннер как его видит витрина. Отдаём все три картинки сразу, а не одну по
 * заголовку Accept-Language: язык на клиенте хранится в localStorage и
 * переключается без перезагрузки, так что выбор картинки — его работа, а ответ
 * остаётся кэшируемым в одном экземпляре.
 */
export class BannerDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Школьный базар — выгода до 50%' })
  title: string;

  @ApiProperty({ format: 'uuid' })
  photoRu: string;

  @ApiProperty({ format: 'uuid' })
  photoUzLatn: string;

  @ApiProperty({ format: 'uuid' })
  photoUzCyrl: string;

  /**
   * `type` указан явно: по объявлению `string | null` рефлексия отдаёт Object,
   * и в спеке поле выходит без типа — на клиенте оно приезжает как `unknown`.
   */
  @ApiProperty({ type: String, nullable: true, example: '/product/12' })
  linkUrl: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: 0 })
  sortOrder: number;

  @ApiPropertyOptional({ format: 'date-time' })
  createdAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  updatedAt?: string;
}
