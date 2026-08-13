import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { ReportsService } from './reports.service';
import { FindReportsQueryDto } from './dto/find-reports-query.dto';

@ApiTags('reports')
@ApiBearerAuth('access-token')
@AdminOnly()
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить разобранную жалобу' })
  @ApiResponse({ status: 404, description: 'Жалоба не найдена' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.reportsService.adminRemove(id);
  }
}
