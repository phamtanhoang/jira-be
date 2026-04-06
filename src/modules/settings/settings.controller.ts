import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../core/decorators/public.decorator.js';
import { Roles } from '../../core/decorators/roles.decorator.js';
import { SetSettingDto } from './dto/set-setting.dto.js';
import { SettingsService } from './settings.service.js';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Public()
  @Get('app-info')
  @ApiOperation({ summary: 'Get app info (name, logo, description)' })
  getAppInfo() {
    return this.settingsService.getAppInfo();
  }

  @Get(':key')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get a setting by key (Admin only)' })
  getByKey(@Param('key') key: string) {
    return this.settingsService.getByKey(key);
  }

  @Put(':key')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create or update a setting by key (Admin only)' })
  setByKey(@Param('key') key: string, @Body() dto: SetSettingDto) {
    return this.settingsService.setByKey(key, dto.value);
  }
}
