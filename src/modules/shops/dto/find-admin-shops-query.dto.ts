import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FindAdminShopsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Поиск по названию, контакту, адресу магазина или владельцу',
    example: 'техно',
  })
  @IsOptional()
  @IsString()
  q?: string;
}
