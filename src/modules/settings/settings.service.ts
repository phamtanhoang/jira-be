import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MSG } from '../../core/constants/message.constant.js';
import { SETTING_KEYS } from '../../core/constants/settings.constant.js';
import { PrismaService } from '../../core/database/prisma.service.js';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getAppInfo() {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.APP_INFO },
    });
    if (!setting) throw new NotFoundException(MSG.APP_INFO_NOT_FOUND);

    return setting.value;
  }

  async getByKey(key: string) {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException(MSG.SETTING_NOT_FOUND);
    return setting;
  }

  async setByKey(key: string, value: Prisma.InputJsonValue) {
    return this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
