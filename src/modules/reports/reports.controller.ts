import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Оставить жалобу на магазин или товар (без авторизации)',
  })
  @ApiResponse({ status: 201, description: 'Жалоба создана' })
  @ApiResponse({ status: 404, description: 'Магазин или товар не найден' })
  create(@Body() dto: CreateReportDto) {
    return this.reportsService.create(dto);
  }
}
