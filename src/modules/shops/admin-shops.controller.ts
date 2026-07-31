import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { ShopsService } from './shops.service';
import { ReasonDto } from '../../common/dto/reason.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

@ApiTags('shops-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/shops')
export class AdminShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Get()
  @ApiOperation({ summary: 'Все магазины с числом товаров' })
  list(@Query() query: PaginationQueryDto) {
    return this.shopsService.adminList(query);
  }

  @Patch(':id/abolish')
  @ApiOperation({ summary: 'Упразднить магазин с обязательной причиной' })
  abolish(@Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.shopsService.adminAbolish(id, dto.reason);
  }

  @Patch(':id/restore')
  @ApiOperation({ summary: 'Вернуть упразднённый магазин в работу' })
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.shopsService.adminRestore(id);
  }
}
