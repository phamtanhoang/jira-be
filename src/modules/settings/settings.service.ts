import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MSG, SETTING_KEYS } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { uploadFile } from '@/core/utils';
import { AdminAuditService } from '@/modules/admin-audit/admin-audit.service';

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private audit: AdminAuditService,
  ) {}

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

  /**
   * Public snapshot of the maintenance flag. Returns `null` when the setting
   * is missing so the FE middleware can treat that as "not in maintenance".
   */
  async getAppMaintenance() {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.APP_MAINTENANCE },
    });
    return setting?.value ?? null;
  }

  async getByKey(key: string) {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException(MSG.ERROR.SETTING_NOT_FOUND);
    return setting;
  }

  /**
   * Upload a new app logo to Supabase and write its URL into the `app.info`
   * setting's `logoUrl` field. Preserves other fields.
   */
  async uploadAppLogo(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    actorId: string,
  ) {
    const url = await uploadFile(buffer, fileName, mimeType);

    const existing = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.APP_INFO },
    });
    const current =
      (existing?.value as Record<string, unknown> | null | undefined) ?? {};
    const nextValue = { ...current, logoUrl: url };

    await this.prisma.setting.upsert({
      where: { key: SETTING_KEYS.APP_INFO },
      update: { value: nextValue as Prisma.InputJsonValue },
      create: {
        key: SETTING_KEYS.APP_INFO,
        value: nextValue as Prisma.InputJsonValue,
      },
    });
    this.audit.log(actorId, 'SETTING_UPDATE', {
      target: SETTING_KEYS.APP_INFO,
      targetType: 'Setting',
      payload: { logoUrl: url },
    });
    return { message: MSG.SUCCESS.SETTINGS_UPDATED, logoUrl: url };
  }

  async setByKey(key: string, value: Prisma.InputJsonValue, actorId: string) {
    const row = await this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    this.audit.log(actorId, 'SETTING_UPDATE', {
      target: key,
      targetType: 'Setting',
    });
    return row;
  }
}
