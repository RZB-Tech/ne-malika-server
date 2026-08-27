import { Module } from '@nestjs/common';
import { SearchStatsRepository } from './search-stats.repository';
import { SearchStatsService } from './search-stats.service';

@Module({
  providers: [SearchStatsRepository, SearchStatsService],
  exports: [SearchStatsService],
})
export class SearchStatsModule {}
