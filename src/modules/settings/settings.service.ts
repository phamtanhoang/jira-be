import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MSG, SETTING_KEYS } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { MailService } from '@/core/mail/mail.service';
import { uploadFile } from '@/core/utils';
import { AdminAuditService } from '@/modules/admin-audit/admin-audit.service';

/**
 * Placeholder used by GET /settings/app.email so the SMTP password is never
 * shipped to the browser. Admin UI sends the same sentinel back on save when
 * they didn't change it; the service then preserves the existing value.
 */
const PASSWORD_PLACEHOLDER = '__keep__';

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
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
    if (key === SETTING_KEYS.APP_EMAIL) {
      return { ...setting, value: redactAppEmail(setting.value) };
    }
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
    let nextValue = value;

    // For app.email the FE never receives the real SMTP password (we redact
    // it on GET). When it sends `__keep__` back on save, swap in the existing
    // password from DB so the secret round-trips without ever leaving the
    // server.
    if (key === SETTING_KEYS.APP_EMAIL) {
      const existing = await this.prisma.setting.findUnique({ where: { key } });
      nextValue = mergeAppEmailPassword(value, existing?.value);
    }

    const row = await this.prisma.setting.upsert({
      where: { key },
      update: { value: nextValue },
      create: { key, value: nextValue },
    });

    if (key === SETTING_KEYS.APP_EMAIL) {
      // Force the next send to rebuild its transporter against the new creds.
      this.mail.invalidateTransport();
    }

    this.audit.log(actorId, 'SETTING_UPDATE', {
      target: key,
      targetType: 'Setting',
    });

    if (key === SETTING_KEYS.APP_EMAIL) {
      return { ...row, value: redactAppEmail(row.value) };
    }
    return row;
  }
}

function redactAppEmail(value: Prisma.JsonValue): Prisma.JsonValue {
  if (!isPlainObject(value)) return value;
  const v = value as Record<string, unknown>;
  if (!isPlainObject(v.smtp)) return v as Prisma.JsonValue;
  const smtp = v.smtp as Record<string, unknown>;
  return {
    ...v,
    smtp: {
      ...smtp,
      password: smtp.password ? PASSWORD_PLACEHOLDER : '',
    },
  } as Prisma.JsonValue;
}

function mergeAppEmailPassword(
  incoming: Prisma.InputJsonValue,
  existing: Prisma.JsonValue | undefined,
): Prisma.InputJsonValue {
  if (!isPlainObject(incoming)) return incoming;
  const next = incoming as Record<string, unknown>;
  if (!isPlainObject(next.smtp)) return incoming;
  const nextSmtp = next.smtp as Record<string, unknown>;
  if (nextSmtp.password !== PASSWORD_PLACEHOLDER) return incoming;

  const prevSmtp =
    isPlainObject(existing) && isPlainObject((existing as Record<string, unknown>).smtp)
      ? ((existing as Record<string, unknown>).smtp as Record<string, unknown>)
      : null;
  return {
    ...next,
    smtp: {
      ...nextSmtp,
      password: prevSmtp?.password ?? '',
    },
  } as Prisma.InputJsonValue;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
