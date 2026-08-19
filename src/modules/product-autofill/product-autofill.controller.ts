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
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SellerOrAdmin } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ProductAutofillService } from './product-autofill.service';
import {
  AutofillPriceDto,
  AutofillProductDto,
  AutofilledProductDto,
} from './dto/product-autofill.dto';

/**
 * Автозаполнение карточки. Одна ручка обслуживает и создание товара, и правку:
 * работа там одна и та же — прочитать фотографии и вернуть поля, — а разница
 * лишь в том, что при правке часть полей уже заполнена и уходит в запрос.
 */
@ApiTags('product-autofill')
@ApiBearerAuth('access-token')
@SellerOrAdmin()
@Controller('product-autofill')
export class ProductAutofillController {
  constructor(private readonly autofill: ProductAutofillService) {}

  @Get('price')
  @ApiOperation({ summary: 'Цена автозаполнения и остаток кредитов магазина' })
  @ApiResponse({ status: 200, type: AutofillPriceDto })
  price(@CurrentUser() user: AuthenticatedUser): Promise<AutofillPriceDto> {
    return this.autofill.price({
      id: user.id,
      isAdmin: user.role === 'admin',
    });
  }

  /**
   * Лимит жёстче обычного: каждый запрос — платная работа модели по трём
   * фотографиям. Десяти в минуту хватает и на подбор варианта, и на правку
   * нескольких карточек подряд, а перебором кнопки баланс уже не спустить.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Заполнить описание и характеристики товара по его фотографиям',
  })
  @ApiResponse({ status: 200, type: AutofilledProductDto })
  fill(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AutofillProductDto,
  ): Promise<AutofilledProductDto> {
    return this.autofill.fill(dto, {
      id: user.id,
      isAdmin: user.role === 'admin',
    });
  }
}
