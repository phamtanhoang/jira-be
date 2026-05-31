/**
 * Seed the `Setting` table with sensible defaults for every key the app
 * reads. Idempotent — runs `upsert` per key, safe to invoke any number of
 * times. Existing rows keep their saved values via `update: {}` (a no-op
 * patch) so re-running NEVER overwrites admin-edited config.
 *
 * Run:   npx prisma db seed
 *
 * If you want to FORCE-RESET a specific key back to defaults (e.g. you
 * messed up app.email and want the seed value), delete that row in Prisma
 * Studio first, then re-run the seed.
 */
import 'dotenv/config';
import { hash } from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma, Role } from '@prisma/client';

// Prisma 7 with the PG adapter requires the client be constructed with an
// explicit adapter — bare `new PrismaClient()` throws. Mirrors the runtime
// setup in `src/core/database/prisma.service.ts`.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/**
 * Admin bootstrap credentials. Override via env so production seeds don't
 * use the hardcoded fallback. Print a warning when falling back so nobody
 * accidentally ships the default password live.
 */
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? 'Admin';

const SETTING_KEYS = {
  APP_INFO: 'app.info',
  APP_EMAIL: 'app.email',
  APP_FEATURES: 'app.features',
  APP_ANNOUNCEMENT: 'app.announcement',
  APP_MAINTENANCE: 'app.maintenance',
  APP_AUTH_PROVIDERS: 'app.auth_providers',
  APP_QUOTAS: 'app.quotas',
  APP_EMAIL_TEMPLATES: 'app.email_templates',
} as const;

// ─── Email template bodies ──────────────────────────────────────────
// Declared up here so the `SEED` object below can reference them without
// hitting TS2448 (used before declaration). Table-based layout + inline
// styles for Gmail/Outlook/Yahoo compatibility. `{{var}}` tokens resolved
// at send time by `MailService.renderTemplate`.

const VERIFICATION_EMAIL_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify your email</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#172b4d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(9,30,66,0.08);overflow:hidden;">
          <tr>
            <td style="background:#ffffff;padding:28px 40px;text-align:center;border-bottom:1px solid #ebecf0;">
              <img src="{{logoUrl}}" alt="{{appName}}" width="36" height="36" style="display:inline-block;vertical-align:middle;margin-right:10px;border:0;border-radius:8px;" />
              <span style="color:#172b4d;font-size:22px;font-weight:700;vertical-align:middle;letter-spacing:-0.3px;">{{appName}}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 16px;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#172b4d;">Verify your email</h1>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#5e6c84;">
                Hi, we received a sign-up request for <strong style="color:#172b4d;">{{recipientEmail}}</strong>.
                Enter the code below to confirm your email address.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 40px 16px;">
              <div style="display:inline-block;padding:18px 32px;background:#f4f5f7;border-radius:10px;font-family:'SF Mono','Consolas','Courier New',monospace;font-size:32px;font-weight:700;color:#0052cc;letter-spacing:8px;">
                {{otp}}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#5e6c84;text-align:center;">
                This code expires in <strong style="color:#172b4d;">{{expiryMinutes}} minutes</strong>.<br/>
                If you didn't sign up, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;background:linear-gradient(135deg,#0052cc 0%,#2684ff 100%);text-align:center;">
              <p style="margin:0;font-size:12px;color:#ffffff;opacity:0.9;">
                © {{appName}} — automated message, please do not reply.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const RESET_PASSWORD_EMAIL_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#172b4d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(9,30,66,0.08);overflow:hidden;">
          <tr>
            <td style="background:#ffffff;padding:28px 40px;text-align:center;border-bottom:1px solid #ebecf0;">
              <img src="{{logoUrl}}" alt="{{appName}}" width="36" height="36" style="display:inline-block;vertical-align:middle;margin-right:10px;border:0;border-radius:8px;" />
              <span style="color:#172b4d;font-size:22px;font-weight:700;vertical-align:middle;letter-spacing:-0.3px;">{{appName}}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 16px;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#172b4d;">Reset your password</h1>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#5e6c84;">
                Hi, we received a password reset request for <strong style="color:#172b4d;">{{recipientEmail}}</strong>.
                Use the code below to set a new password.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 40px 16px;">
              <div style="display:inline-block;padding:18px 32px;background:#fff4f0;border:1px solid #ffd5c2;border-radius:10px;font-family:'SF Mono','Consolas','Courier New',monospace;font-size:32px;font-weight:700;color:#de350b;letter-spacing:8px;">
                {{otp}}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 24px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#5e6c84;text-align:center;">
                This code expires in <strong style="color:#172b4d;">{{expiryMinutes}} minutes</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px;">
              <div style="padding:14px 16px;background:#fffae6;border:1px solid #ffe380;border-radius:8px;">
                <p style="margin:0;font-size:13px;line-height:1.5;color:#172b4d;">
                  <strong>Didn't request this?</strong> Someone may have entered your email by mistake.
                  Ignore this message — your password stays unchanged. If you keep getting these, contact support.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;background:linear-gradient(135deg,#de350b 0%,#ff7452 100%);text-align:center;">
              <p style="margin:0;font-size:12px;color:#ffffff;opacity:0.9;">
                © {{appName}} — automated message, please do not reply.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const WELCOME_EMAIL_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to {{appName}}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#172b4d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(9,30,66,0.08);overflow:hidden;">
          <tr>
            <td style="background:#ffffff;padding:32px 40px;text-align:center;border-bottom:1px solid #ebecf0;">
              <img src="{{logoUrl}}" alt="{{appName}}" width="40" height="40" style="display:inline-block;vertical-align:middle;margin-right:12px;border:0;border-radius:8px;" />
              <span style="color:#172b4d;font-size:24px;font-weight:700;vertical-align:middle;letter-spacing:-0.3px;">{{appName}}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 24px;">
              <h1 style="margin:0 0 12px;font-size:24px;font-weight:600;color:#172b4d;">Welcome aboard! 🎉</h1>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#5e6c84;">
                Hi, your account <strong style="color:#172b4d;">{{recipientEmail}}</strong> is now verified and ready.
                Here's how to get the most out of {{appName}}:
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 16px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #ebecf0;">
                    <span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;background:#deebff;color:#0052cc;font-weight:700;font-size:13px;text-align:center;vertical-align:middle;margin-right:12px;">1</span>
                    <span style="font-size:14px;color:#172b4d;vertical-align:middle;"><strong>Create your first workspace</strong> — invite teammates, set roles.</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #ebecf0;">
                    <span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;background:#deebff;color:#0052cc;font-weight:700;font-size:13px;text-align:center;vertical-align:middle;margin-right:12px;">2</span>
                    <span style="font-size:14px;color:#172b4d;vertical-align:middle;"><strong>Spin up a project</strong> — board, sprints and backlog are auto-created.</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;">
                    <span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;background:#deebff;color:#0052cc;font-weight:700;font-size:13px;text-align:center;vertical-align:middle;margin-right:12px;">3</span>
                    <span style="font-size:14px;color:#172b4d;vertical-align:middle;"><strong>Drag your first issue</strong> across the board — that's the loop.</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 40px 32px;">
              <a href="https://jira.3hteam.io.vn/dashboard" style="display:inline-block;padding:12px 28px;background:#0052cc;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
                Open dashboard →
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;background:linear-gradient(135deg,#00875a 0%,#36b37e 100%);text-align:center;">
              <p style="margin:0;font-size:12px;color:#ffffff;opacity:0.9;">
                Sent to {{recipientEmail}} · © {{appName}}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const OAUTH_LINKED_EMAIL_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign-in method linked</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#172b4d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(9,30,66,0.08);overflow:hidden;">
          <tr>
            <td style="background:#ffffff;padding:28px 40px;text-align:center;border-bottom:1px solid #ebecf0;">
              <img src="{{logoUrl}}" alt="{{appName}}" width="36" height="36" style="display:inline-block;vertical-align:middle;margin-right:10px;border:0;border-radius:8px;" />
              <span style="color:#172b4d;font-size:22px;font-weight:700;vertical-align:middle;letter-spacing:-0.3px;">{{appName}}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px 12px;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#172b4d;">{{providerLabel}} sign-in linked</h1>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#5e6c84;">
                Hi, we just connected <strong style="color:#172b4d;">{{providerLabel}}</strong> as a sign-in method for your account
                <strong style="color:#172b4d;">{{recipientEmail}}</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 24px;">
              <div style="padding:14px 16px;background:#fff7e6;border:1px solid #ffe0a3;border-radius:8px;">
                <p style="margin:0;font-size:13px;line-height:1.5;color:#172b4d;">
                  <strong>Didn't do this?</strong> Sign in and remove {{providerLabel}} from
                  <em>Profile → Connected accounts</em>, then rotate your password.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#5e6c84;text-align:center;">
                You're getting this because a new sign-in method was attached to your {{appName}} account.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;background:linear-gradient(135deg,#f59e0b 0%,#fbbf24 100%);text-align:center;">
              <p style="margin:0;font-size:12px;color:#ffffff;opacity:0.95;">
                © {{appName}} — automated security notice
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Defaults dictionary. Shape of each value mirrors the corresponding
 * `*Value` type in `jira-fe/src/features/admin/types.ts` and the BE
 * `SettingsService.get*` methods. If a shape ever changes, edit BOTH the
 * type and this seed in lockstep.
 */
const SEED: Record<string, Prisma.InputJsonValue> = {
  // Public app branding. Shown in header, sign-in page, email footers.
  // `logoUrl` empty → header falls back to the AppName + initials avatar.
  [SETTING_KEYS.APP_INFO]: {
    name: 'Jira Clone',
    logoUrl: '',
    description: 'Project management for small teams.',
    authorName: '3hteam',
    authorUrl: 'https://jira.3hteam.io.vn',
  },

  // Mail provider config. Default uses Resend's no-domain-needed sender so
  // a fresh install can send verification/reset emails immediately without
  // verifying a custom domain. Switch to your own domain (or SMTP) via
  // /admin/settings → Email when ready.
  [SETTING_KEYS.APP_EMAIL]: {
    provider: 'resend',
    fromEmail: 'onboarding@resend.dev',
    fromName: 'Jira Clone',
    smtp: {
      host: '',
      port: 587,
      secure: false,
      user: '',
      password: '',
    },
  },

  // Open feature-flag dictionary. Flags are added as `{ key: bool }` via
  // /admin/flags when feature-gated rollouts begin.
  [SETTING_KEYS.APP_FEATURES]: {},

  // Top-of-app banner. Disabled by default — enable + write a message
  // for downtime/release/maintenance notices.
  [SETTING_KEYS.APP_ANNOUNCEMENT]: {
    enabled: false,
    message: '',
    severity: 'info',
  },

  // Maintenance gate. When enabled, FE middleware blocks all non-admin
  // routes; `allowedEmails` is the bypass list for admins to keep working.
  [SETTING_KEYS.APP_MAINTENANCE]: {
    enabled: false,
    message: '',
    allowedEmails: [],
  },

  // Auth provider toggles. All enabled by default so OAuth + password
  // login all work out of the box (assuming env credentials are set).
  [SETTING_KEYS.APP_AUTH_PROVIDERS]: {
    password: true,
    google: true,
    github: true,
  },

  // Tenant-level quotas. `0` = unlimited (default for a fresh install).
  // Bump these once you want to enforce limits per workspace.
  [SETTING_KEYS.APP_QUOTAS]: {
    maxProjectsPerWorkspace: 0,
    maxMembersPerWorkspace: 0,
    maxStorageGB: 0,
  },

  // Admin-overridable email bodies. Each one is a full HTML email with
  // {{placeholders}} resolved by MailService.renderTemplate. Placeholders
  // available: appName, logoUrl, otp, expiryMinutes, recipientEmail,
  // providerLabel. Empty entries fall back to the built-in hardcoded
  // template — we ship branded defaults instead.
  [SETTING_KEYS.APP_EMAIL_TEMPLATES]: {
    verification: {
      subject: 'Verify your email — {{appName}}',
      html: VERIFICATION_EMAIL_HTML,
    },
    resetPassword: {
      subject: 'Reset your password — {{appName}}',
      html: RESET_PASSWORD_EMAIL_HTML,
    },
    welcome: {
      subject: 'Welcome to {{appName}}!',
      html: WELCOME_EMAIL_HTML,
    },
    oauthLinked: {
      subject: '{{providerLabel}} sign-in linked to your {{appName}} account',
      html: OAUTH_LINKED_EMAIL_HTML,
    },
  },
};

async function seedSettings() {
  const results: Array<{ key: string; status: 'created' | 'kept' }> = [];

  for (const [key, value] of Object.entries(SEED)) {
    const existing = await prisma.setting.findUnique({ where: { key } });
    if (existing) {
      // Never overwrite live admin config. Re-running seed should be safe.
      results.push({ key, status: 'kept' });
      continue;
    }
    await prisma.setting.create({ data: { key, value } });
    results.push({ key, status: 'created' });
  }

  console.log('\nSetting seed complete:');
  for (const r of results) {
    const tag = r.status === 'created' ? '+' : '·';
    console.log(`  ${tag} ${r.key.padEnd(24)} ${r.status}`);
  }
  console.log(
    `\n${results.filter((r) => r.status === 'created').length} created, ${
      results.filter((r) => r.status === 'kept').length
    } kept (already present).`,
  );
}

/**
 * Bootstrap a verified ADMIN user so the app is usable on a fresh DB without
 * needing to manually flip role + emailVerified after sign-up.
 *
 * Idempotent: if the email already exists we ONLY ensure role=ADMIN +
 * emailVerified are set. We NEVER overwrite an existing password — that
 * would silently reset credentials the admin had already rotated.
 */
async function seedAdmin() {
  const usingDefaultPassword =
    !process.env.SEED_ADMIN_PASSWORD ||
    process.env.SEED_ADMIN_PASSWORD === 'Admin@12345';

  const existing = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
  });

  if (existing) {
    const needsPromotion =
      existing.role !== Role.ADMIN || !existing.emailVerified;
    if (needsPromotion) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          role: Role.ADMIN,
          emailVerified: existing.emailVerified ?? new Date(),
          active: true,
        },
      });
      console.log(`\nAdmin user promoted: ${ADMIN_EMAIL}`);
    } else {
      console.log(`\nAdmin user already present: ${ADMIN_EMAIL} (kept)`);
    }
    return;
  }

  const hashed = await hash(ADMIN_PASSWORD, 12);
  await prisma.user.create({
    data: {
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: hashed,
      role: Role.ADMIN,
      emailVerified: new Date(),
      active: true,
    },
  });

  console.log(`\nAdmin user created:`);
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
  if (usingDefaultPassword) {
    console.log(
      `  ⚠ Default password in use — change it immediately at /profile, or`,
    );
    console.log(
      `    re-run with SEED_ADMIN_PASSWORD=<strong-pass> to set your own.`,
    );
  }
}

async function main() {
  await seedSettings();
  await seedAdmin();
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
