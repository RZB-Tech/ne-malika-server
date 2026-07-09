import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { ReportsService } from './reports.service';
import { FindReportsQueryDto } from './dto/find-reports-query.dto';

@ApiTags('reports')
@ApiBearerAuth('access-token')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @ApiOperation({
    summary: 'Список жалоб с фильтрами по магазину/товару (администратор)',
  })
  findAll(@Query() query: FindReportsQueryDto) {
    return this.reportsService.findAllForAdmin(query);
  }
}
