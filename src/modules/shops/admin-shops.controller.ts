import { Body, Controller, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { ShopsService } from './shops.service';
import { AbolishShopDto } from './dto/abolish-shop.dto';

@ApiTags('shops-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/shops')
export class AdminShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Patch(':id/abolish')
  @ApiOperation({ summary: 'Упразднить магазин с обязательной причиной' })
  abolish(@Param('id', ParseIntPipe) id: number, @Body() dto: AbolishShopDto) {
    return this.shopsService.adminAbolish(id, dto.reason);
  }
}
