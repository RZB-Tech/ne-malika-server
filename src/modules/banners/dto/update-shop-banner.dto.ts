import { PartialType } from '@nestjs/swagger';
import { CreateShopBannerDto } from './create-shop-banner.dto';

/**
 * Правка баннера продавцом. Все поля необязательны: чаще всего меняют одну
 * картинку из трёх, и требовать присылать остальные две значило бы заставлять
 * форму гонять по сети то, что не менялось.
 *
 * Наследуется от `CreateShopBannerDto`, а не от `CreateBannerDto`: `isActive`
 * и `sortOrder` продавцу недоступны и при правке — иначе запрещённое на входе
 * поле пролезало бы вторым запросом.
 */
export class UpdateShopBannerDto extends PartialType(CreateShopBannerDto) {}
