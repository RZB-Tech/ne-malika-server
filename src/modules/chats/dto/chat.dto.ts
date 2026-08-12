import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';

/**
 * Столько влезает в сообщение, которое ещё читают. Длиннее — это уже не вопрос
 * продавцу, а простыня, и почти всегда попытка вставить рекламу.
 */
export const MESSAGE_MAX = 2000;

/** С какой стороны смотрит запрашивающий: своя переписка или переписка магазина. */
export const CHAT_ROLES = ['buyer', 'seller'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export class StartChatDto {
  @ApiPropertyOptional({
    description:
      'Товар, о котором спрашивают. Без него разговор идёт с магазином целиком',
    example: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productCardId?: number;

  @ApiPropertyOptional({
    description: 'Магазин. Обязателен, если товар не указан',
    example: 3,
  })
  @ValidateIf((dto: StartChatDto) => dto.productCardId === undefined)
  @Type(() => Number)
  @IsInt()
  shopId?: number;

  @ApiProperty({
    maxLength: MESSAGE_MAX,
    example: 'Здравствуйте! Ещё в наличии?',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX)
  text: string;
}

export class SendMessageDto {
  @ApiProperty({
    maxLength: MESSAGE_MAX,
    example: 'Да, могу отложить до завтра',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX)
  text: string;
}

export class FindChatsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: CHAT_ROLES,
    default: 'buyer',
    description:
      '«buyer» — мои переписки как покупателя, «seller» — переписки моего магазина',
  })
  @IsOptional()
  @IsIn(CHAT_ROLES)
  role?: ChatRole;
}

export class ChatMessageDto {
  @ApiProperty({ example: 1024 })
  id: number;

  @ApiProperty({
    enum: ['buyer', 'seller', 'ai'],
    description: 'Чей голос. «ai» — автоответ от имени магазина',
  })
  kind: 'buyer' | 'seller' | 'ai';

  @ApiProperty()
  text: string;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  readAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class ChatDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 3 })
  shopId: number;

  @ApiProperty({ example: 'TechnoDom' })
  shopName: string;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  shopPhoto: string | null;

  @ApiProperty({ example: 42 })
  buyerId: number;

  @ApiProperty({ example: 'Азиз Рахимов' })
  buyerName: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Товар, с которого начался разговор. null — товар снят',
  })
  productCardId: number | null;

  @ApiProperty({ type: String, nullable: true })
  productName: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  productPhoto: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastMessageText: string | null;

  @ApiProperty({ format: 'date-time' })
  lastMessageAt: string;

  @ApiProperty({
    description: 'Непрочитанные сообщения для той стороны, которая запросила',
    example: 2,
  })
  unread: number;
}

export class ChatStartedDto {
  @ApiProperty({ description: 'id переписки — начатой сейчас или найденной' })
  id: number;
}

export class PaginatedChatsDto {
  @ApiProperty({ type: [ChatDto] })
  data: ChatDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class PaginatedChatMessagesDto {
  @ApiProperty({ type: [ChatMessageDto] })
  data: ChatMessageDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class ChatUnreadDto {
  @ApiProperty({
    description: 'Непрочитанное в моих покупательских переписках',
  })
  buyer: number;

  @ApiProperty({ description: 'Непрочитанное в переписках моего магазина' })
  seller: number;
}
