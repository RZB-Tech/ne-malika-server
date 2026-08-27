import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ReviewsService } from './reviews.service';
import { FindReviewsQueryDto } from './dto/find-reviews-query.dto';

@ApiTags('reviews-seller')
@ApiBearerAuth('access-token')
@SellerOnly()
@Controller('seller/reviews')
export class SellerReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Отзывы о моём магазине и его товарах' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FindReviewsQueryDto,
  ) {
    return this.reviewsService.listForOwner(user.id, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Моя средняя оценка и разбивка по звёздам' })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.reviewsService.summaryForOwner(user.id);
  }
}
