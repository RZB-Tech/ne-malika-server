import { PartialType } from '@nestjs/swagger'; // см. замечание выше
import { CreateProductCardDto } from './create-product-card.dto';

export class UpdateProductCardDto extends PartialType(CreateProductCardDto) {}
