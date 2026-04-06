import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../core/decorators/public.decorator.js';
import { SetSettingDto } from './dto/set-setting.dto.js';
import { SettingsService } from './settings.service.js';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get all settings' })
  getSettings() {
    return this.settingsService.getAll();
  }

  @Public()
  @Put()
  @ApiOperation({ summary: 'Set a setting by key' })
  setSetting(@Body() dto: SetSettingDto) {
    return this.settingsService.setByKey(dto.key, dto.value);
  }
}
