import { PartialType } from '@nestjs/swagger'; // заменили на swagger-версию — сохраняет ApiProperty из базового DTO
import { CreateShopDto } from './create-shop.dto';

export class UpdateShopDto extends PartialType(CreateShopDto) {}
