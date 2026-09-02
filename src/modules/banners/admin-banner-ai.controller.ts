import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { BannerAiService } from './banner-ai.service';
import {
  AdminGenerateBannerDto,
  AdminTranslateBannerDto,
  BannerAiPriceDto,
  GeneratedBannerDto,
} from './dto/generate-banner.dto';

/**
 * Рисование баннера моделью из админки.
 *
 * Отличий от продавцовой ручки два: магазин администратор называет сам, а
 * списания нет — его запросы оплачивает площадка, как и везде. Тариф магазина
 * здесь тоже не спрашивается: администратор и есть тот, кто выдаёт баннер, и
 * запрещать ему нечем.
 *
 * Баннер эти ручки не создают: они возвращают ключи картинок и предложенное
 * название, а собирает баннер обычный `POST /admin/banners`.
 */
@ApiTags('banners-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/banners/ai')
export class AdminBannerAiController {
  constructor(private readonly bannerAi: BannerAiService) {}

  @Get('price')
  @ApiOperation({
    summary: 'Во сколько обходится генерация. Администратору — без списания',
  })
  @ApiOkResponse({ type: BannerAiPriceDto })
  price(@CurrentUser() admin: AuthenticatedUser): Promise<BannerAiPriceDto> {
    return this.bannerAi.price({ id: admin.id, isAdmin: true });
  }

  @Post('ru')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Нарисовать баннер магазину на русском',
    description:
      'Модель разбирает выбранный магазин — название, разделы каталога, ' +
      'товары и их фотографии — и сама придумывает, что нарисовать и как ' +
      'назвать баннер. Ссылка ведёт на страницу магазина.',
  })
  @ApiOkResponse({ type: GeneratedBannerDto })
  @ApiResponse({ status: 404, description: 'Магазин не найден' })
  @ApiResponse({ status: 502, description: 'Модель не нарисовала баннер' })
  @ApiResponse({ status: 503, description: 'ИИ-функции выключены: нет ключа' })
  generateRu(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: AdminGenerateBannerDto,
  ): Promise<GeneratedBannerDto> {
    return this.bannerAi.generateRu(
      { id: admin.id, isAdmin: true, shopId: dto.shopId },
      dto.productIds,
    );
  }

  @Post('uz')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Перевести принятый баннер на узбекский',
    description:
      'Рисует ту же картинку с узбекскими надписями: вёрстка, фон и товары ' +
      'остаются прежними.',
  })
  @ApiOkResponse({ type: GeneratedBannerDto })
  @ApiResponse({ status: 400, description: 'Русский баннер не найден' })
  @ApiResponse({ status: 404, description: 'Магазин не найден' })
  @ApiResponse({ status: 502, description: 'Модель не нарисовала баннер' })
  generateUz(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: AdminTranslateBannerDto,
  ): Promise<GeneratedBannerDto> {
    return this.bannerAi.generateUz(
      { id: admin.id, isAdmin: true, shopId: dto.shopId },
      dto.photoKey,
    );
  }
}
