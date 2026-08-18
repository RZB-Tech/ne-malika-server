import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { ProductStatsService } from './product-stats.service';
import { StatsRangeQueryDto } from './dto/product-stats.dto';
import { AdminActivityDto } from './dto/admin-activity.dto';

@ApiTags('stats-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/stats')
export class AdminStatsController {
  constructor(private readonly productStatsService: ProductStatsService) {}

  @Get('activity')
  @ApiOperation({
    summary: 'Активность площадки по дням',
    description:
      'Товары, магазины и регистрации считаются по created_at, просмотры и контакты — из суточного агрегата. Ряд сплошной: сутки без событий приходят нулями.',
  })
  @ApiResponse({ status: 200, type: AdminActivityDto })
  activity(@Query() query: StatsRangeQueryDto): Promise<AdminActivityDto> {
    return this.productStatsService.adminActivity(query.days ?? 30);
  }
}
