import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';
import { ENDPOINTS, UPLOAD_LIMITS, isAllowedMime } from '@/core/constants';
import { CurrentUser, Public, Roles } from '@/core/decorators';
import type { AuthUser } from '@/core/types';
import { SetSettingDto } from './dto/set-setting.dto';
import { SettingsService } from './settings.service';

const E = ENDPOINTS.SETTINGS;

@ApiTags('Settings')
@Controller(E.BASE)
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  // Public settings GETs change rarely (admin-toggled). A short Cache-Control
  // keeps browsers + CDN edge from hammering us on every page navigation.
  // 60s max-age is short enough that admin toggles propagate quickly; the
  // stale-while-revalidate window lets cached responses keep serving while a
  // fresh one is fetched in the background.
  @Public()
  @Get(E.APP_INFO)
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Get app info (name, logo, description)' })
  getAppInfo() {
    return this.settingsService.getAppInfo();
  }

  @Public()
  @Get(E.APP_ANNOUNCEMENT)
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({
    summary: 'Get the announcement banner (null if not configured)',
  })
  getAppAnnouncement() {
    return this.settingsService.getAppAnnouncement();
  }

  @Public()
  @Get(E.APP_MAINTENANCE)
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({
    summary: 'Get the maintenance-mode flag (null if not configured)',
  })
  getAppMaintenance() {
    return this.settingsService.getAppMaintenance();
  }

  @Get(E.BY_KEY)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get a setting by key (Admin only)' })
  getByKey(@Param('key') key: string) {
    return this.settingsService.getByKey(key);
  }

  @Post(E.APP_INFO_LOGO)
  @Roles(Role.ADMIN)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a new app logo and persist URL into app.info (Admin only)',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_LIMITS.LOGO.maxSize },
      fileFilter: (_req, file, cb) => {
        if (isAllowedMime(UPLOAD_LIMITS.LOGO, file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('File type not allowed'), false);
        }
      },
    }),
  )
  uploadLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.settingsService.uploadAppLogo(
      file.buffer,
      file.originalname,
      file.mimetype,
      user.id,
    );
  }

  @Put(E.BY_KEY)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create or update a setting by key (Admin only)' })
  setByKey(
    @Param('key') key: string,
    @Body() dto: SetSettingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settingsService.setByKey(key, dto.value, user.id);
  }
}
