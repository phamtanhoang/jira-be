import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ENDPOINTS } from '@/core/constants';
import { Public, Roles } from '@/core/decorators';
import { SetSettingDto } from './dto/set-setting.dto';
import { SettingsService } from './settings.service';

const E = ENDPOINTS.SETTINGS;

@ApiTags('Settings')
@Controller(E.BASE)
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Public()
  @Get(E.APP_INFO)
  @ApiOperation({ summary: 'Get app info (name, logo, description)' })
  getAppInfo() {
    return this.settingsService.getAppInfo();
  }

  @Get(E.BY_KEY)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get a setting by key (Admin only)' })
  getByKey(@Param('key') key: string) {
    return this.settingsService.getByKey(key);
  }

  @Put(E.BY_KEY)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create or update a setting by key (Admin only)' })
  setByKey(@Param('key') key: string, @Body() dto: SetSettingDto) {
    return this.settingsService.setByKey(key, dto.value);
  }
}
