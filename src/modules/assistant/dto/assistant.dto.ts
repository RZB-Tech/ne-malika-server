import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class AssistantMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @Matches(/\S/u)
  @MaxLength(2000)
  content: string;
}

export class AssistantRequestDto {
  @ApiProperty({ type: [AssistantMessageDto], maxItems: 13 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(13)
  @ValidateNested({ each: true })
  @Type(() => AssistantMessageDto)
  messages: AssistantMessageDto[];

  @ApiPropertyOptional({
    description: 'Product page and previous recommendations',
    type: [Number],
    maxItems: 8,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  productIds?: number[];
}

export class AssistantProductDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) price: string | null;
  @ApiProperty({ enum: ['new', 'old'] }) state: 'new' | 'old';
  @ApiProperty() shopName: string;
  @ApiProperty({ type: String, nullable: true }) photo: string | null;
}

export class AssistantLinkDto {
  @ApiProperty() label: string;
  @ApiProperty() href: string;
}

export class AssistantResponseDto {
  @ApiProperty() message: string;
  @ApiProperty({ type: [String] }) suggestions: string[];
  @ApiProperty({ type: [AssistantProductDto] }) products: AssistantProductDto[];
  @ApiProperty({ type: [AssistantLinkDto] }) links: AssistantLinkDto[];
}
