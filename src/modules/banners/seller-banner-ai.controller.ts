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
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { BannerAiService } from './banner-ai.service';
import {
  BannerAiPriceDto,
  GenerateBannerDto,
  GeneratedBannerDto,
  TranslateBannerDto,
} from './dto/generate-banner.dto';

/**
 * Рисование баннера моделью.
 *
 * Отдельный контроллер, а не пара ручек в `SellerBannersController`: там
 * управление уже готовым баннером в базе, здесь — платная работа модели со
 * своим лимитом частоты. Сам баннер эти ручки не создают, они лишь возвращают
 * ключи картинок: собирает баннер обычный `POST /seller/banners`, и только
 * тогда он уходит на модерацию.
 */
@ApiTags('banners-seller')
@ApiBearerAuth('access-token')
@SellerOnly()
@Controller('seller/banners/ai')
export class SellerBannerAiController {
  constructor(private readonly bannerAi: BannerAiService) {}

  @Get('price')
  @ApiOperation({
    summary: 'Сколько стоит генерация баннера и хватает ли кредитов',
  })
  @ApiOkResponse({ type: BannerAiPriceDto })
  @ApiResponse({ status: 404, description: 'Магазин не найден' })
  price(@CurrentUser() user: AuthenticatedUser): Promise<BannerAiPriceDto> {
    return this.bannerAi.price(user.id);
  }

  /**
   * Лимит жёстче общего: каждый запрос — платная картинка, а перегенерация
   * подряд десять раз означает не подбор, а забытый в цикле клиент.
   */
  @Post('ru')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Нарисовать баннер на русском',
    description:
      'Берёт название магазина, его разделы каталога и до трёх товаров с ' +
      'фотографиями. Не нравится — вызовите ещё раз, каждый вызов платный.',
  })
  @ApiOkResponse({ type: GeneratedBannerDto })
  @ApiResponse({ status: 403, description: 'Тариф не даёт баннер' })
  @ApiResponse({ status: 502, description: 'Модель не нарисовала баннер' })
  @ApiResponse({ status: 503, description: 'ИИ-функции выключены: нет ключа' })
  generateRu(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateBannerDto,
  ): Promise<GeneratedBannerDto> {
    return this.bannerAi.generateRu(user.id, dto);
  }

  @Post('uz')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Перевести принятый баннер на узбекский',
    description:
      'Рисует ту же картинку с узбекскими надписями: вёрстка, фон и товары ' +
      'остаются прежними. Вызывается после того, как русский вариант устроил.',
  })
  @ApiOkResponse({ type: GeneratedBannerDto })
  @ApiResponse({ status: 400, description: 'Русский баннер не найден' })
  @ApiResponse({ status: 403, description: 'Тариф не даёт баннер' })
  @ApiResponse({ status: 502, description: 'Модель не нарисовала баннер' })
  generateUz(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TranslateBannerDto,
  ): Promise<GeneratedBannerDto> {
    return this.bannerAi.generateUz(user.id, dto);
  }
}
