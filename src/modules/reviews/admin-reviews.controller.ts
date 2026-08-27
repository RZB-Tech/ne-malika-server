import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ReviewsService } from './reviews.service';
import { FindAdminReviewsQueryDto } from './dto/find-admin-reviews-query.dto';
import { RejectReviewDto } from './dto/reject-review.dto';

@ApiTags('reviews-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Отзывы с фильтром по статусу — очередь модерации' })
  list(@Query() query: FindAdminReviewsQueryDto) {
    return this.reviewsService.listForAdmin(query);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Сколько отзывов ждёт проверки, принято и отклонено',
  })
  stats() {
    return this.reviewsService.stats();
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Опубликовать отзыв' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.reviewsService.publish(id, user.id);
  }

  @Post(':id/recheck')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Прогнать отзыв через ИИ-проверку заново',
  })
  recheck(@Param('id', ParseIntPipe) id: number) {
    return this.reviewsService.recheck(id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Отклонить отзыв с причиной — её увидит автор',
  })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectReviewDto,
  ) {
    return this.reviewsService.decline(id, user.id, dto.reason);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить отзыв безвозвратно' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.reviewsService.adminRemove(id);
  }
}
