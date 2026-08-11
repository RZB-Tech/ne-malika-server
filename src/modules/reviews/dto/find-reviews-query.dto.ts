import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FindReviewsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 10,
    description: 'Отзывы о конкретном товаре',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  product_id?: number;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Отзывы о магазине — вместе с отзывами о его товарах, ровно как считается оценка продавца',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shop_id?: number;
}
