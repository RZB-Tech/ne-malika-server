import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { ImageGenService } from './image-gen.service';
import {
  DescribePromptDto,
  GenerateImagesDto,
  GeneratedImageDto,
} from './dto/generate-images.dto';

@ApiTags('image-gen-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/image-gen')
export class AdminImageGenController {
  constructor(private readonly imageGenService: ImageGenService) {}

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
  generate(@Body() dto: GenerateImagesDto): Promise<GeneratedImageDto[]> {
    return this.imageGenService.generate(dto);
  }
}
