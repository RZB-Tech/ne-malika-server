import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ProductStatsService } from './product-stats.service';
import { RecordProductEventDto } from './dto/record-product-event.dto';

@ApiTags('product-stats')
@Public()
@Controller('product-cards')
export class ProductStatsController {
  constructor(private readonly productStatsService: ProductStatsService) {}

  @Post(':id/events')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Отметить просмотр карточки или контакт с продавцом',
    description:
      'Боты и повторы в пределах получаса отбрасываются молча — ответ 204 не значит, что событие учтено.',
  })
  @ApiResponse({ status: 204, description: 'Принято' })
  @ApiResponse({ status: 404, description: 'Товар не найден или скрыт' })
  record(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecordProductEventDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    return this.productStatsService.record(
      id,
      dto.kind,
      dto.visitor_id,
      userAgent,
    );
  }
}
