import { PartialType } from '@nestjs/swagger';
import { CreateShopBannerDto } from './create-shop-banner.dto';

export class UpdateShopBannerDto extends PartialType(CreateShopBannerDto) {}
