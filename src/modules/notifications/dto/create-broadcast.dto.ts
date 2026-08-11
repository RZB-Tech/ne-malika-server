import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const BROADCAST_AUDIENCES = ['all', 'sellers', 'buyers'] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

/**
 * Потолок взят у Telegram: sendMessage не принимает текст длиннее 4096
 * символов, и обрезать чужую рассылку молча было бы хуже, чем не принять её.
 */
export const BROADCAST_MAX_LENGTH = 4096;

export class CreateBroadcastDto {
  @ApiProperty({ enum: BROADCAST_AUDIENCES })
  @IsIn(BROADCAST_AUDIENCES)
  audience: BroadcastAudience;

  @ApiProperty({
    minLength: 5,
    maxLength: BROADCAST_MAX_LENGTH,
    description: 'Текст сообщения. Допускается HTML-разметка Telegram.',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(BROADCAST_MAX_LENGTH)
  text: string;
}

export class BroadcastAudienceCountDto {
  @ApiProperty({ description: 'Сколько адресатов получат рассылку сейчас' })
  count: number;
}

export class BroadcastDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: BROADCAST_AUDIENCES })
  audience: BroadcastAudience;

  @ApiProperty()
  text: string;

  @ApiProperty()
  recipients: number;

  @ApiProperty()
  delivered: number;

  @ApiProperty()
  failed: number;

  @ApiProperty()
  createdAt: string;

  @ApiPropertyOptional({ nullable: true })
  authorName: string | null;
}
