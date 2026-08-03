import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Выдача магазинов для администратора. Поиск идёт и по самому магазину, и по
 * его владельцу: в списке одна строка описывает обоих, и админ ищет то по
 * названию, то по фамилии продавца.
 */
export class FindAdminShopsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Поиск по названию, контакту, адресу магазина или владельцу',
    example: 'техно',
  })
  @IsOptional()
  @IsString()
  q?: string;
}
