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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { ProductCardsService } from './product-cards.service';
import { ReasonDto } from '../../common/dto/reason.dto';
import { FindAdminProductCardsQueryDto } from './dto/find-admin-product-cards-query.dto';
import { CreateProductCardDto } from './dto/create-product-card.dto';
import { UpdateProductCardDto } from './dto/update-product-card.dto';
import { AiChecksService } from '../ai/ai-checks.service';

@ApiTags('product-cards-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/product-cards')
export class AdminProductCardsController {
  constructor(
    private readonly productCardsService: ProductCardsService,
    private readonly aiChecksService: AiChecksService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Все товары с фильтром по статусу — включая скрытые и упразднённые',
  })
  findAll(@Query() query: FindAdminProductCardsQueryDto) {
    return this.productCardsService.findAllForAdmin(query);
  }

  @Get('ai-review')
  @ApiOperation({
    summary:
      'Очередь ручной модерации: проверки со сбоем сервиса или вердиктом fail',
  })
  aiReview() {
    return this.aiChecksService.listNeedingReview();
  }

  @Post('shops/:shopId')
  @ApiOperation({ summary: 'Создать товар в любом магазине' })
  create(
    @Param('shopId', ParseIntPipe) shopId: number,
    @Body() dto: CreateProductCardDto,
  ) {
    return this.productCardsService.adminCreate(shopId, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Отредактировать любой товар' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductCardDto,
  ) {
    return this.productCardsService.adminUpdate(id, dto);
  }

  @Post(':id/recheck')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отправить товар на ИИ-проверку заново' })
  recheck(@Param('id', ParseIntPipe) id: number) {
    return this.productCardsService.adminRecheck(id);
  }

  @Patch(':id/abolish')
  @ApiOperation({ summary: 'Упразднить товар с обязательной причиной' })
  abolish(@Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.productCardsService.adminAbolish(id, dto.reason);
  }

  @Patch(':id/restore')
  @ApiOperation({
    summary:
      'Вернуть товар, автоматически скрытый ИИ-проверкой, в публичную выдачу',
  })
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.productCardsService.adminRestore(id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Удалить товар безвозвратно. Для обратимой блокировки — abolish',
  })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.productCardsService.adminRemove(id);
  }

  @Post('activate-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Обслуживание: снять скрытие со всех товаров разом',
  })
  activateAll() {
    return this.productCardsService.activateAll();
  }

  @Post('ai-checks/pass-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Обслуживание: пометить все ИИ-проверки как пройденные',
  })
  passAllAiChecks() {
    return this.productCardsService.passAllAiChecks();
  }
}
