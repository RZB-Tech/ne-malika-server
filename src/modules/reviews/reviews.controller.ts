import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AnyRole } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { FindReviewsQueryDto } from './dto/find-reviews-query.dto';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Опубликованные отзывы о товаре или магазине',
  })
  list(@Query() query: FindReviewsQueryDto) {
    return this.reviewsService.listPublic(query);
  }

  @Public()
  @Get('summary')
  @ApiOperation({
    summary: 'Средняя оценка и разбивка по звёздам',
  })
  summary(@Query() query: FindReviewsQueryDto) {
    return this.reviewsService.summary(query);
  }

  @AnyRole()
  @ApiBearerAuth('access-token')
  @Get('mine')
  @ApiOperation({ summary: 'Мои отзывы, включая ожидающие проверки' })
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FindReviewsQueryDto,
  ) {
    return this.reviewsService.listOwn(user.id, query);
  }

  @AnyRole()
  @ApiBearerAuth('access-token')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post()
  @ApiOperation({ summary: 'Оставить отзыв (публикуется после проверки)' })
  @ApiResponse({ status: 201, description: 'Отзыв принят и ждёт модерации' })
  @ApiResponse({ status: 403, description: 'Отзыв о собственном магазине' })
  @ApiResponse({ status: 409, description: 'Отзыв уже был оставлен' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(user.id, dto);
  }

  @AnyRole()
  @ApiBearerAuth('access-token')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Patch(':id')
  @ApiOperation({
    summary: 'Изменить свой отзыв — он снова уходит на проверку',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviewsService.updateOwn(user.id, id, dto);
  }

  @AnyRole()
  @ApiBearerAuth('access-token')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить свой отзыв' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.reviewsService.removeOwn(user.id, id);
  }
}
