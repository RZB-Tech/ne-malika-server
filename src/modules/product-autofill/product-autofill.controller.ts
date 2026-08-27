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

@ApiTags('product-autofill')
@ApiBearerAuth('access-token')
@SellerOrAdmin()
@Controller('product-autofill')
export class ProductAutofillController {
  constructor(private readonly autofill: ProductAutofillService) {}

  @Get('price')
  @ApiOperation({
    summary:
      'Цена следующего автозаполнения: бесплатно по норме или безлимиту ' +
      'тарифа либо по прайсу, плюс остаток кредитов магазина',
  })
  @ApiResponse({ status: 200, type: AutofillPriceDto })
  price(@CurrentUser() user: AuthenticatedUser): Promise<AutofillPriceDto> {
    return this.autofill.price({
      id: user.id,
      isAdmin: user.role === 'admin',
    });
  }

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
