import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { ParseUUIDPipe } from '@nestjs/common';
import { SellerOrAdmin } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ImageGenService } from './image-gen.service';
import {
  DescribePromptDto,
  GenerateImagesDto,
  GeneratedImageDto,
  ImageGenBalanceDto,
  RewriteDescriptionDto,
  RewrittenDescriptionDto,
  StoredImageDto,
} from './dto/generate-images.dto';

/**
 * Генерация карточек. Раздел админский по истории, но пользуются им и
 * продавцы — за счёт кредитов своего магазина.
 */
@ApiTags('image-gen')
@ApiBearerAuth('access-token')
@SellerOrAdmin()
@Controller('image-gen')
export class ImageGenController {
  constructor(private readonly imageGenService: ImageGenService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Остаток кредитов магазина на ИИ' })
  @ApiResponse({ status: 200, type: ImageGenBalanceDto })
  balance(@CurrentUser() user: AuthenticatedUser): Promise<ImageGenBalanceDto> {
    return this.imageGenService.balance(user.id, user.role === 'admin');
  }

  @Get('history')
  @ApiOperation({
    summary: 'Ранее сгенерированные картинки по этой же фотографии',
  })
  @ApiResponse({ status: 200, type: [StoredImageDto] })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('photoKey', new ParseUUIDPipe({ version: '4' })) photoKey: string,
  ) {
    return this.imageGenService.history(user.id, photoKey);
  }

  @Post('prompt')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Составить промпт по фотографии товара' })
  describe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DescribePromptDto,
  ) {
    return this.imageGenService.describePrompt(dto, {
      id: user.id,
      isAdmin: user.role === 'admin',
    });
  }

  @Post('description')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Исправить описание товара, сверяясь с его фотографией',
  })
  @ApiResponse({ status: 200, type: RewrittenDescriptionDto })
  rewriteDescription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RewriteDescriptionDto,
  ): Promise<RewrittenDescriptionDto> {
    return this.imageGenService.rewriteDescription(dto, {
      id: user.id,
      isAdmin: user.role === 'admin',
    });
  }

  /** Лимит жёстче обычного: каждый запрос — до четырёх платных картинок. */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Перерисовать фотографию товара: 1–4 варианта на выбор',
  })
  @ApiResponse({ status: 200, type: [GeneratedImageDto] })
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateImagesDto,
  ): Promise<GeneratedImageDto[]> {
    return this.imageGenService.generate(dto, {
      id: user.id,
      isAdmin: user.role === 'admin',
    });
  }
}
