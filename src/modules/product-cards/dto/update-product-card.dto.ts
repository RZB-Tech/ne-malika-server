import { PartialType } from '@nestjs/swagger';
import { CreateProductCardDto } from './create-product-card.dto';

export class UpdateProductCardDto extends PartialType(CreateProductCardDto) {}
