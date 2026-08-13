import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { BannersService } from './banners.service';
import { BannerDto } from './dto/banner-response.dto';

@ApiTags('banners-public')
@Controller('banners')
export class BannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Баннеры главной страницы в порядке показа' })
  @ApiOkResponse({ type: [BannerDto] })
  findAll() {
    return this.bannersService.findActive();
  }
}
