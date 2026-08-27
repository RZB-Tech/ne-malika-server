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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { FavoritesService } from './favorites.service';
import { AddFavoriteDto } from './dto/add-favorite.dto';
import { SyncFavoritesDto } from './dto/sync-favorites.dto';
import { PaginatedFavoritesDto } from './dto/favorite.dto';

@ApiTags('me-favorites')
@ApiBearerAuth('access-token')
@Controller('me/favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'Избранное, недавно добавленные сверху' })
  @ApiResponse({ status: 200, type: PaginatedFavoritesDto })
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.favoritesService.findMine(user.id, query);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Добавить товар в избранное' })
  @ApiResponse({ status: 404, description: 'Товар не найден или недоступен' })
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddFavoriteDto) {
    return this.favoritesService.add(user.id, dto.product_card_id);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Перенести избранное, накопленное до входа (localStorage)',
  })
  sync(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncFavoritesDto) {
    return this.favoritesService.sync(user.id, dto);
  }

  @Delete()
  @ApiOperation({ summary: 'Очистить избранное целиком' })
  clear(@CurrentUser() user: AuthenticatedUser) {
    return this.favoritesService.clear(user.id);
  }

  @Delete(':productCardId')
  @ApiOperation({ summary: 'Убрать товар из избранного' })
  @ApiResponse({ status: 404, description: 'Товара нет в избранном' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productCardId', ParseIntPipe) productCardId: number,
  ) {
    return this.favoritesService.remove(user.id, productCardId);
  }
}
