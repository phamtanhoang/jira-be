import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MSG, SETTING_KEYS } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getAppInfo() {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.APP_INFO },
    });
    if (!setting) throw new NotFoundException(MSG.ERROR.APP_INFO_NOT_FOUND);

    return setting.value;
  }

  /**
   * Public snapshot of the announcement banner. Returns `null` when the
   * setting has never been saved so the FE can render "nothing" without
   * needing 404 handling.
   */
  async getAppAnnouncement() {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.APP_ANNOUNCEMENT },
    });
    return setting?.value ?? null;
  }

  async getByKey(key: string) {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException(MSG.ERROR.SETTING_NOT_FOUND);
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
