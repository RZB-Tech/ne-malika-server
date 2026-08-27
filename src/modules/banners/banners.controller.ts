import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { BannersService } from './banners.service';
import { PublicBannerDto } from './dto/public-banner.dto';

@ApiTags('banners-public')
@Controller('banners')
export class BannersController {
  constructor(private readonly bannersService: BannersService) {}

  /**
   * Ответ описан `PublicBannerDto`, а не `BannerDto`: с появлением баннеров
   * продавцов у строки завелись поля модерации, и `rejectReason` — текст
   * администратора продавцу — в публичной выдаче не должен появиться ни при
   * каких обстоятельствах. Разбор — в докблоке самого DTO.
   */
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Баннеры главной страницы в порядке показа',
    description:
      'Карусель площадки вперемешку с оплаченными баннерами магазинов: ' +
      'первое место за площадкой, дальше баннеры продавцов в ротации.',
  })
  @ApiOkResponse({ type: [PublicBannerDto] })
  findAll() {
    return this.bannersService.findActive();
  }
}
