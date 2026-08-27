import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { FindReviewsQueryDto } from './find-reviews-query.dto';

type ReviewStatus = 'pending' | 'approved' | 'rejected';

const REVIEW_STATUSES: ReviewStatus[] = ['pending', 'approved', 'rejected'];

export class FindAdminReviewsQueryDto extends FindReviewsQueryDto {
  @ApiPropertyOptional({ enum: REVIEW_STATUSES, example: 'pending' })
  @IsOptional()
  @IsIn(REVIEW_STATUSES)
  status?: ReviewStatus;
}
