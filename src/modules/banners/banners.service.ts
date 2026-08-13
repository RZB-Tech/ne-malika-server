import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BannersRepository } from './banners.repository';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@Injectable()
export class BannersService {
  constructor(private readonly repository: BannersRepository) {}

  /** Витрина главной. */
  findActive() {
    return this.repository.findActive();
  }

  findAllForAdmin() {
    return this.repository.findAll();
  }

  /**
   * Новый баннер встаёт в конец карусели, если порядок не задан явно: иначе
   * все созданные подряд получали бы sortOrder 0 и раскладывались по id — то
   * есть в порядке создания, но без возможности его поменять.
   */
  async create(dto: CreateBannerDto) {
    const sortOrder =
      dto.sortOrder ?? (await this.repository.maxSortOrder()) + 1;

    return this.repository.create({
      title: dto.title,
      photoRu: dto.photoRu,
      photoUzLatn: dto.photoUzLatn,
      photoUzCyrl: dto.photoUzCyrl,
      /** `||`, а не `??`: пустая строка из формы — это «без ссылки», как и её отсутствие. */
      linkUrl: dto.linkUrl || null,
      isActive: dto.isActive ?? true,
      sortOrder,
    });
  }

  async update(id: number, dto: UpdateBannerDto) {
    await this.getOrFail(id);

    /**
     * `linkUrl` разбираем отдельно: пустая строка из формы — это «убрать
     * ссылку», а не «сохранить пустую». Спред без этого клал бы в базу '' и
     * баннер оставался кликабельным, ведя в никуда.
     */
    const { linkUrl, ...rest } = dto;

    return this.repository.update(id, {
      ...rest,
      ...(linkUrl === undefined ? {} : { linkUrl: linkUrl || null }),
    });
  }

  async remove(id: number) {
    await this.getOrFail(id);
    await this.repository.delete(id);
  }

  /**
   * Перестановка карусели. Незнакомый id — отказ целиком: применить порядок
   * частично значит молча перемешать список не так, как показала админка.
   */
  async reorder(ids: number[]) {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) {
      throw new BadRequestException('В порядке есть повторяющиеся id');
    }

    const existing = await this.repository.findAll();
    const known = new Set(existing.map((b) => b.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new BadRequestException(
        `Баннеры не найдены: ${unknown.join(', ')}`,
      );
    }

    await this.repository.applyOrder(ids);
    return this.repository.findAll();
  }

  private async getOrFail(id: number) {
    const banner = await this.repository.findById(id);
    if (!banner) {
      throw new NotFoundException('Баннер не найден');
    }
    return banner;
  }
}
