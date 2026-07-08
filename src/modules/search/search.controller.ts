import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SearchService } from './search.service';
import { PromptSearchDto } from './dto/promt-search.dto';
import { PromptSearchResponseDto } from './dto/promt-search-response.dto';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Public()
  @Post('prompt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Промпт-поиск товаров на естественном языке (с fallback на обычный поиск)',
  })
  @ApiResponse({ status: 200, type: PromptSearchResponseDto })
  promptSearch(@Body() dto: PromptSearchDto) {
    return this.searchService.promptSearch(dto);
  }
}
