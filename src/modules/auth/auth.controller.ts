import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  fePublicCookieOptions,
  refreshTokenCookieOptions,
} from '@/core/constants';
import { CurrentUser, Public } from '@/core/decorators';
import { AuthUser } from '@/core/types';
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
  constructor(
    private authService: AuthService,
    private settings: SettingsService,
  ) {}

  @Public()
  @Post(E.REGISTER)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Register a new user' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post(E.VERIFY_EMAIL)
  @HttpCode(HttpStatus.OK)
  // 5 attempts per 5 min — matches the OTP expiry window; defends against
  // brute-forcing the 6-digit code.
  @Throttle({ default: { ttl: 300000, limit: 5 } })
  @ApiOperation({ summary: 'Verify email with 6-digit OTP' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
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
    const tokens = await this.authService.login(dto, extractSessionMeta(req));

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
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[COOKIE_KEYS.REFRESH_TOKEN];
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    res.clearCookie(COOKIE_KEYS.ACCESS_TOKEN);
    res.clearCookie(COOKIE_KEYS.REFRESH_TOKEN, { path: '/' });

    return { message: MSG.SUCCESS.LOGOUT };
  }

  @Public()
  @Post(E.FORGOT_PASSWORD)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Send reset password OTP' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post(E.RESET_PASSWORD)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with OTP' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
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
  ) {
    return this.authService.unlinkOAuthAccount(user.id, provider);
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
      return res.redirect(`${frontend}/dashboard`);
    } catch (err) {
      // Log the full reason server-side so admins can debug OAuth flow
      // failures instead of having to decode the redirect URL.
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[auth] OAuth callback failed for ${profile.provider}/${profile.email}: ${message}`,
      );
      const code = message ? encodeURIComponent(message) : 'oauth_failed';
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
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto);
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
    res.clearCookie(COOKIE_KEYS.ACCESS_TOKEN);
    res.clearCookie(COOKIE_KEYS.REFRESH_TOKEN, { path: '/' });
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
