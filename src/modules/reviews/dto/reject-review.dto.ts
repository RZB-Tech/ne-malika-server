import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectReviewDto {
  @ApiProperty({
    minLength: 3,
    maxLength: 300,
    example: 'Мат и оскорбления в адрес продавца',
    description:
      'Причину видит автор отзыва, поэтому пишется человеческим языком',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}
