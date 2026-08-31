import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AnyRole } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @AnyRole()
  @ApiBearerAuth('access-token')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Оставить жалобу на магазин или товар',
  })
  @ApiResponse({ status: 201, description: 'Жалоба создана' })
  @ApiResponse({ status: 403, description: 'Жалоба на собственный магазин' })
  @ApiResponse({ status: 404, description: 'Магазин или товар не найден' })
  @ApiResponse({ status: 409, description: 'Жалоба уже была оставлена' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportDto) {
    return this.reportsService.create(user.id, dto);
  }
}
