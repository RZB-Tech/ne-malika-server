import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ShopsService } from './shops.service';

@ApiTags('shops-public')
@Controller('shops')
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Карточка магазина с его активными товарами' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Магазин найден' })
  @ApiResponse({ status: 404, description: 'Магазин не найден или упразднён' })
  getPublic(@Param('id', ParseIntPipe) id: number) {
    return this.shopsService.getPublicById(id);
  }
}
