import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
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
import {
  AdminOnly,
  SellerOrAdmin,
} from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ImageGenService } from './image-gen.service';
import {
  DescribePromptDto,
  GenerateImagesDto,
  GeneratedImageDto,
  ImageGenAccessDto,
  ImageGenQuotaDto,
  StoredImageDto,
} from './dto/generate-images.dto';

/**
 * Генерация карточек. Раздел админский по истории, но пользуются им и
 * продавцы — тем, кому администратор выдал доступ и квоту.
 */
@ApiTags('image-gen')
@ApiBearerAuth('access-token')
@SellerOrAdmin()
@Controller('image-gen')
export class ImageGenController {
  constructor(private readonly imageGenService: ImageGenService) {}

  @Get('quota')
  @ApiOperation({ summary: 'Доступ и остаток по генерации изображений' })
  @ApiResponse({ status: 200, type: ImageGenQuotaDto })
  quota(@CurrentUser() user: AuthenticatedUser): Promise<ImageGenQuotaDto> {
    return this.imageGenService.quota(user.id, user.role === 'admin');
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
  describe(@Body() dto: DescribePromptDto) {
    return this.imageGenService.describePrompt(dto);
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

/** Выдача доступа и квоты — это уже только администратор. */
@ApiTags('image-gen-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/image-gen')
export class AdminImageGenController {
  constructor(private readonly imageGenService: ImageGenService) {}

  @Get('access/:userId')
  @ApiOperation({ summary: 'Текущий доступ и расход пользователя' })
  @ApiResponse({ status: 200, type: ImageGenQuotaDto })
  access(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<ImageGenQuotaDto> {
    return this.imageGenService.quota(userId, false);
  }

  @Patch('access/:userId')
  @ApiOperation({ summary: 'Выдать или снять доступ к генерации' })
  @ApiResponse({ status: 200, type: ImageGenQuotaDto })
  setAccess(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: ImageGenAccessDto,
  ): Promise<ImageGenQuotaDto> {
    return this.imageGenService.setAccess(userId, dto);
  }
}
