import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import {
  COOKIE_KEYS,
  ENDPOINTS,
  ENV,
  MSG,
  UPLOAD_LIMITS,
  accessTokenCookieOptions,
  clearAuthCookie,
  fePublicCookieOptions,
  refreshTokenCookieOptions,
} from '@/core/constants';
import { CurrentUser, Public } from '@/core/decorators';
import { MailService } from '@/core/mail/mail.service';
import { AuthUser } from '@/core/types';
import {
  EventLoggerService,
  EVENTS,
} from '@/modules/logs/event-logger.service';
import { SettingsService } from '@/modules/settings/settings.service';
import { AuthService, type SessionMeta } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './dto';
import { isGithubConfigured } from './strategies/github.strategy';
import { isGoogleConfigured } from './strategies/google.strategy';
import type { OAuthProfile } from './strategies/oauth.types';

const E = ENDPOINTS.AUTH;

@ApiTags('Auth')
@Controller(E.BASE)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private authService: AuthService,
    private settings: SettingsService,
    private events: EventLoggerService,
    private mail: MailService,
  ) {}

  @Public()
  @Post(E.REGISTER)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Register a new user' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const result = await this.authService.register(dto);
    this.events.log(EVENTS.AUTH_SIGNUP, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      metadata: { email: dto.email },
    });
    return result;
  }

  @Public()
  @Post(E.VERIFY_EMAIL)
  @HttpCode(HttpStatus.OK)
  // 5 attempts per 5 min — matches the OTP expiry window; defends against
  // brute-forcing the 6-digit code.
  @Throttle({ default: { ttl: 300000, limit: 5 } })
  @ApiOperation({ summary: 'Verify email with 6-digit OTP' })
  async verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request) {
    const result = await this.authService.verifyEmail(dto);
    this.events.log(EVENTS.AUTH_EMAIL_VERIFIED, {
      ip: req.ip ?? null,
      metadata: { email: dto.email },
    });
    return result;
  }

  @Public()
  @Post(E.LOGIN)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Login and receive JWT tokens' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Reject password logins when admin disabled the password provider.
    // OAuth flows live on separate routes and aren't gated here.
    const providers = await this.settings.getAuthProviders();
    if (!providers.password) {
      throw new UnauthorizedException(MSG.ERROR.PASSWORD_LOGIN_DISABLED);
    }
    let tokens;
    try {
      tokens = await this.authService.login(dto, extractSessionMeta(req));
    } catch (err) {
      // Security event — failed login attempts deserve audit even when
      // we just throw 401 to the user. Email is in the request body
      // (sanitized of password by global pipe / class-transformer).
      this.events.log(EVENTS.AUTH_LOGIN_FAILED, {
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        metadata: {
          email: dto.email,
          reason: err instanceof Error ? err.message : 'unknown',
        },
      });
      throw err;
    }

    this.events.log(EVENTS.AUTH_LOGIN_SUCCESS, {
      userEmail: dto.email,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });

    res.cookie(
      COOKIE_KEYS.ACCESS_TOKEN,
      tokens.accessToken,
      accessTokenCookieOptions(tokens.expiresIn),
    );
    res.cookie(
      COOKIE_KEYS.REFRESH_TOKEN,
      tokens.refreshToken,
      refreshTokenCookieOptions(),
    );

    return tokens;
  }

  @Public()
  @Post(E.REFRESH)
  @HttpCode(HttpStatus.OK)
  // 10/min — allow a small burst when several tabs refresh at once.
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[COOKIE_KEYS.REFRESH_TOKEN];
    if (!refreshToken) {
      throw new UnauthorizedException(MSG.ERROR.REFRESH_TOKEN_NOT_FOUND);
    }

    const tokens = await this.authService.refresh(
      refreshToken,
      extractSessionMeta(req),
    );

    res.cookie(
      COOKIE_KEYS.ACCESS_TOKEN,
      tokens.accessToken,
      accessTokenCookieOptions(tokens.expiresIn),
    );
    res.cookie(
      COOKIE_KEYS.REFRESH_TOKEN,
      tokens.refreshToken,
      refreshTokenCookieOptions(),
    );

    return tokens;
  }

  @Post(E.LOGOUT)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Logout and clear tokens' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[COOKIE_KEYS.REFRESH_TOKEN];
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    clearAuthCookie(res, COOKIE_KEYS.ACCESS_TOKEN);
    clearAuthCookie(res, COOKIE_KEYS.REFRESH_TOKEN);
    // Defensive: wipe the FE-readable flags server-side too. The FE
    // `useLogout` hook also clears them via `document.cookie`, but if the
    // page navigates away mid-mutation that JS never runs — without this,
    // `is_authenticated=1` would survive logout and let the next protected
    // navigation skip the sign-in redirect.
    clearAuthCookie(res, COOKIE_KEYS.IS_AUTHENTICATED);
    clearAuthCookie(res, COOKIE_KEYS.USER_ROLE);

    this.events.log(EVENTS.AUTH_LOGOUT, {
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      ip: req.ip ?? null,
    });

    return { message: MSG.SUCCESS.LOGOUT };
  }

  @Public()
  @Post(E.FORGOT_PASSWORD)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Send reset password OTP' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const result = await this.authService.forgotPassword(dto);
    this.events.log(EVENTS.AUTH_PASSWORD_RESET_REQUESTED, {
      ip: req.ip ?? null,
      metadata: { email: dto.email },
    });
    return result;
  }

  @Public()
  @Post(E.RESET_PASSWORD)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with OTP' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    const result = await this.authService.resetPassword(dto);
    this.events.log(EVENTS.AUTH_PASSWORD_CHANGED, {
      ip: req.ip ?? null,
      metadata: { email: dto.email, via: 'reset' },
    });
    return result;
  }

  // ─── OAuth ─────────────────────────────────────────────

  @Public()
  @Get(E.OAUTH_PROVIDERS)
  @ApiOperation({
    summary:
      'Which OAuth providers are configured (drives FE button visibility)',
  })
  async oauthProviders() {
    // The FE renders sign-in buttons + the password form by AND-ing two
    // signals: env-level configuration (do we have client-id/secret?) and
    // the admin toggle in `app.auth_providers`. Either off → button hidden.
    const toggles = await this.settings.getAuthProviders();
    return {
      password: toggles.password,
      google: toggles.google && isGoogleConfigured(),
      github: toggles.github && isGithubConfigured(),
    };
  }

  @Get(E.OAUTH_ACCOUNTS)
  @ApiOperation({ summary: "List the current user's linked OAuth accounts" })
  async listOAuthAccounts(@CurrentUser() user: AuthUser) {
    const accounts = await this.authService.listOAuthAccounts(user.id);
    return { data: accounts };
  }

  @Delete(E.OAUTH_ACCOUNT_BY_PROVIDER)
  @ApiOperation({ summary: 'Unlink an OAuth account from the current user' })
  async unlinkOAuthAccount(
    @CurrentUser() user: AuthUser,
    @Param('provider') provider: string,
    @Req() req: Request,
  ) {
    const result = await this.authService.unlinkOAuthAccount(user.id, provider);
    this.events.log(EVENTS.AUTH_OAUTH_UNLINKED, {
      userId: user.id,
      userEmail: user.email,
      ip: req.ip ?? null,
      metadata: { provider },
    });
    return result;
  }

  @Public()
  @Get(E.OAUTH_GOOGLE)
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Start Google OAuth flow' })
  // The guard performs the redirect to Google; this handler is never reached.
  googleAuth() {}

  @Public()
  @Get(E.OAUTH_GOOGLE_CALLBACK)
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback — sets cookies, redirects' })
  async googleCallback(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ) {
    return this.handleOAuthCallback(req, res);
  }

  @Public()
  @Get(E.OAUTH_GITHUB)
  @UseGuards(AuthGuard('github'))
  @ApiOperation({ summary: 'Start GitHub OAuth flow' })
  githubAuth() {}

  @Public()
  @Get(E.OAUTH_GITHUB_CALLBACK)
  @UseGuards(AuthGuard('github'))
  @ApiOperation({ summary: 'GitHub OAuth callback — sets cookies, redirects' })
  async githubCallback(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ) {
    return this.handleOAuthCallback(req, res);
  }

  private async handleOAuthCallback(req: Request, res: Response) {
    const profile = req.user as OAuthProfile | undefined;
    const frontend = resolveFrontendUrl();
    if (!profile) {
      return res.redirect(`${frontend}/sign-in?error=oauth_failed`);
    }
    try {
      const tokens = await this.authService.loginWithOAuth(
        profile,
        extractSessionMeta(req),
      );
      res.cookie(
        COOKIE_KEYS.ACCESS_TOKEN,
        tokens.accessToken,
        accessTokenCookieOptions(tokens.expiresIn),
      );
      res.cookie(
        COOKIE_KEYS.REFRESH_TOKEN,
        tokens.refreshToken,
        refreshTokenCookieOptions(),
      );
      // Edge middleware checks `is_authenticated` to allow protected routes
      // and `user_role` to bypass maintenance for admins. Password login
      // sets these on the FE; OAuth has no JS in the redirect chain so we
      // set them server-side here.
      res.cookie(COOKIE_KEYS.IS_AUTHENTICATED, '1', fePublicCookieOptions());
      if (tokens.user.role) {
        res.cookie(
          COOKIE_KEYS.USER_ROLE,
          tokens.user.role,
          fePublicCookieOptions(),
        );
      }

      // Side effects — all fire-and-forget so a downed mail provider or
      // log buffer flush can never block the redirect chain.
      this.events.log(EVENTS.AUTH_LOGIN_SUCCESS, {
        userId: tokens.user.id,
        userEmail: tokens.user.email,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        metadata: { method: 'oauth', provider: profile.provider },
      });

      if (tokens.newlyLinkedProvider) {
        // First time this user authenticates with this provider — emit a
        // security-audit event AND notify the rightful owner so a stolen
        // OAuth session can be spotted.
        this.events.log(EVENTS.AUTH_OAUTH_LINKED, {
          userId: tokens.user.id,
          userEmail: tokens.user.email,
          ip: req.ip ?? null,
          metadata: {
            provider: tokens.newlyLinkedProvider,
            wasNewUser: tokens.wasNewUser,
          },
        });
        void this.mail
          .sendOAuthLinkedEmail(tokens.user.email, tokens.newlyLinkedProvider)
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `oauth-linked email failed for ${tokens.user.email}: ${msg}`,
            );
          });
      }

      if (tokens.wasNewUser) {
        // OAuth-created accounts skip the verify-email flow, so the welcome
        // email never fires from `verifyEmail`. Send it here on first sign-in
        // instead — mirrors what big SaaS apps (Linear, Vercel, Notion) do.
        void this.mail.sendWelcomeEmail(tokens.user.email).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `welcome email (oauth signup) failed for ${tokens.user.email}: ${msg}`,
          );
        });
      }

      return res.redirect(`${frontend}/dashboard`);
    } catch (err) {
      // Log the full reason server-side so admins can debug OAuth flow
      // failures instead of having to decode the redirect URL.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `OAuth callback failed for ${profile.provider}/${profile.email}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      // Map to opaque codes — leaking raw messages exposes internal
      // state (Prisma errors, env-var hints, etc.) to anyone who can
      // inspect a victim's redirect URL.
      const code = mapOAuthErrorToCode(message);
      return res.redirect(`${frontend}/sign-in?error=${code}`);
    }
  }

  @Get(E.ME)
  @ApiOperation({ summary: 'Get current authenticated user' })
  getMe(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Patch(E.ME)
  @ApiOperation({ summary: 'Update current user profile (name, image)' })
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary: 'Change current user password (requires current password)',
  })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    const result = await this.authService.changePassword(user.id, dto);
    this.events.log(EVENTS.AUTH_PASSWORD_CHANGED, {
      userId: user.id,
      userEmail: user.email,
      ip: req.ip ?? null,
      metadata: { via: 'self-change' },
    });
    return result;
  }

  @Post('avatar')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_LIMITS.AVATAR.maxSize },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Upload a new avatar for the current user (JPG/PNG/GIF/WEBP, max 2MB)',
  })
  uploadAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.authService.uploadAvatar(user.id, file);
  }

  // ─── Sessions (user-scoped device management) ──────────

  @Get(E.SESSIONS)
  @ApiOperation({
    summary: 'List active sessions (devices) for the current user',
  })
  listSessions(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.authService.listMySessions(user.id, currentRefreshToken(req));
  }

  @Post(E.SESSIONS_REVOKE_OTHERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign out every session except the current one',
  })
  async revokeOthers(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const count = await this.authService.revokeOtherSessions(
      user.id,
      currentRefreshToken(req),
    );
    return { message: MSG.SUCCESS.SESSIONS_REVOKED, count };
  }

  @Post(E.SESSIONS_REVOKE_ALL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign out every session including the current one',
  })
  async revokeAll(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const count = await this.authService.revokeAllMySessions(user.id);
    clearAuthCookie(res, COOKIE_KEYS.ACCESS_TOKEN);
    clearAuthCookie(res, COOKIE_KEYS.REFRESH_TOKEN);
    return { message: MSG.SUCCESS.SESSIONS_REVOKED, count };
  }

  @Delete(E.SESSION_BY_ID)
  @ApiOperation({ summary: 'Sign out a specific session' })
  async revokeSession(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const currentToken = currentRefreshToken(req);
    const wasCurrent = await this.authService.revokeMySession(
      user.id,
      sessionId,
      currentToken,
    );
    if (wasCurrent) {
      res.clearCookie(COOKIE_KEYS.ACCESS_TOKEN);
      res.clearCookie(COOKIE_KEYS.REFRESH_TOKEN, { path: '/' });
    }
    return { message: MSG.SUCCESS.SESSION_REVOKED, wasCurrent };
  }
}

function currentRefreshToken(req: Request): string | null {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[COOKIE_KEYS.REFRESH_TOKEN] ?? null;
}

// Pick where to land the user after OAuth completes. Prefer the explicit
// FRONTEND_URL env, fall back to the first CORS_ORIGIN entry, then localhost
// so dev still works without configuration.
function resolveFrontendUrl(): string {
  if (ENV.FRONTEND_URL) return ENV.FRONTEND_URL.replace(/\/$/, '');
  const firstOrigin = ENV.CORS_ORIGIN?.split(',')[0]?.trim();
  if (firstOrigin) return firstOrigin.replace(/\/$/, '');
  return 'http://localhost:3000';
}

function extractSessionMeta(req: Request): SessionMeta {
  // Trust `X-Forwarded-For` only if set by the ingress — Express respects
  // `app.set('trust proxy', ...)` to populate `req.ip`. Fallback to socket
  // remoteAddress for local dev where no proxy is in front.
  const ua = req.headers['user-agent'];
  const ip = req.ip ?? req.socket?.remoteAddress ?? undefined;
  return {
    userAgent: typeof ua === 'string' ? ua : undefined,
    ip,
  };
}

// Map raw error messages to a small, opaque set of codes the FE knows
// how to render. We never echo back the original message — it can carry
// internal state (Prisma error class, env-var hints, stack frames) that
// has no business in a URL anyone with the user's clipboard can read.
function mapOAuthErrorToCode(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('verify') && m.includes('email')) return 'oauth_verify_first';
  if (m.includes('inactive') || m.includes('deactivated'))
    return 'oauth_inactive';
  if (m.includes('no_email') || m.includes('email')) return 'oauth_no_email';
  return 'oauth_failed';
}
