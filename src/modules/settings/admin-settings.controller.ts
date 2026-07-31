import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { SettingsService } from './settings.service';
import { AppSettingsDto } from './dto/app-settings.dto';

@ApiTags('settings')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Текущие настройки платформы' })
  @ApiOkResponse({ type: AppSettingsDto })
  get() {
    return this.settingsService.getAll();
  }

  @Patch()
  @ApiOperation({ summary: 'Изменить настройки платформы' })
  @ApiOkResponse({ type: AppSettingsDto })
  update(@Body() dto: AppSettingsDto) {
    return this.settingsService.update(dto);
  }
}
