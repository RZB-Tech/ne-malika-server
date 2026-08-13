import {
  Body,
  Controller,
  Delete,
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
import { FindAdminShopsQueryDto } from './dto/find-admin-shops-query.dto';
import { RestrictedCategoriesDto } from './dto/restricted-categories.dto';

@ApiTags('shops-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/shops')
export class AdminShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Get()
  @ApiOperation({
    summary: 'Все магазины с числом товаров, с поиском по магазину и владельцу',
  })
  list(@Query() query: FindAdminShopsQueryDto) {
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

  @Patch(':id/restricted-categories')
  @ApiOperation({
    summary:
      'Выдать или отозвать доступ магазина к закрытым разделам каталога ' +
      '(«Смартфоны» и «Планшеты»)',
  })
  setRestrictedCategories(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RestrictedCategoriesDto,
  ) {
    return this.shopsService.adminSetRestrictedCategories(id, dto.enabled);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Удалить магазин навсегда (каскадом удаляет товары, владелец снова покупатель)',
  })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.shopsService.adminRemove(id);
  }
}
