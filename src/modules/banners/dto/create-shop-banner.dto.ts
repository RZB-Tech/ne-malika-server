import { OmitType } from '@nestjs/swagger';
import { CreateBannerDto } from './create-banner.dto';

export class CreateShopBannerDto extends OmitType(CreateBannerDto, [
  'isActive',
  'sortOrder',
  'shopId',
  'expiresAt',
] as const) {}
