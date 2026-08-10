import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CategoriesService } from './categories.service';
import { CategoryDto } from './dto/category.dto';

@ApiTags('categories')
@Public()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'Дерево категорий каталога: корни с вложенными подкатегориями',
  })
  @ApiResponse({ status: 200, type: [CategoryDto] })
  findAll(): Promise<CategoryDto[]> {
    return this.categoriesService.getTree();
  }
}
