import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductCardsRepository } from './product-cards.repository';
import { ShopsService } from '../shops/shops.service';
import { CreateProductCardDto } from './dto/create-product-card.dto';
import { UpdateProductCardDto } from './dto/update-product-card.dto';
import { FindProductCardsQueryDto } from './dto/find-product-cards-query.dto';
import { buildPaginatedResult } from 'src/common/dto/paginated-response.dto';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ProductCardsService {
  constructor(
    private readonly productCardsRepository: ProductCardsRepository,
    private readonly shopsService: ShopsService,
    @Inject(forwardRef(() => AiService))
    private readonly aiService: AiService,
  ) {}

  async createForSeller(
    ownerId: number,
    shopId: number,
    dto: CreateProductCardDto,
  ) {
    await this.shopsService.assertOwnership(ownerId, shopId);

    const card = await this.productCardsRepository.create({
      shopId,
      name: dto.name,
      description: dto.description,
      photos: dto.photos,
      price: dto.price.toString(),
      state: dto.state,
      characteristics: dto.characteristics,
    });

    this.aiService.checkProductCard(card.id);
    return card;
  }

  async listForSeller(ownerId: number, shopId: number) {
    await this.shopsService.assertOwnership(ownerId, shopId);
    return this.productCardsRepository.findByShopId(shopId);
  }

  async getOwnOrThrow(ownerId: number, id: number) {
    const card = await this.productCardsRepository.findByIdAndOwner(
      id,
      ownerId,
    );
    if (!card) {
      throw new NotFoundException('Товар не найден');
    }
    return card;
  }

  async updateOwn(ownerId: number, id: number, dto: UpdateProductCardDto) {
    await this.getOwnOrThrow(ownerId, id);
    const patch = {
      ...dto,
      price: dto.price !== undefined ? dto.price.toString() : undefined,
    };
    const updated = await this.productCardsRepository.update(id, patch);
    this.aiService.checkProductCard(id);
    return updated;
  }

  async removeOwn(ownerId: number, id: number) {
    await this.getOwnOrThrow(ownerId, id);
    await this.productCardsRepository.delete(id);
  }

  async adminRestore(id: number) {
    const card = await this.productCardsRepository.findById(id);
    if (!card) {
      throw new NotFoundException('Товар не найден');
    }
    if (card.status === 'abolished') {
      throw new BadRequestException(
        'Товар упразднён администратором — используйте отдельный процесс восстановления, а не снятие ИИ-скрытия',
      );
    }
    return this.productCardsRepository.restore(id);
  }

  async getPublicById(id: number) {
    const card = await this.productCardsRepository.findPublicById(id);
    if (!card) {
      throw new NotFoundException('Товар не найден');
    }
    return card;
  }

  async findPublicList(query: FindProductCardsQueryDto) {
    const { data, total, page, limit } =
      await this.productCardsRepository.findPublicList(query);
    return buildPaginatedResult(data, total, page, limit);
  }

  async adminAbolish(id: number, reason: string) {
    const card = await this.productCardsRepository.findById(id);
    if (!card) {
      throw new NotFoundException('Товар не найден');
    }
    return this.productCardsRepository.abolish(id, reason);
  }
}
