import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  COOKIE_KEYS,
  ENDPOINTS,
  MSG,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
} from '@/core/constants';
import { CurrentUser, Public } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

const E = ENDPOINTS.AUTH;

@ApiTags('Auth')
@Controller(E.BASE)
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post(E.REGISTER)
  @ApiOperation({ summary: 'Register a new user' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post(E.VERIFY_EMAIL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email with 6-digit OTP' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Public()
  @Post(E.LOGIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login and receive JWT tokens' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto);

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
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[COOKIE_KEYS.REFRESH_TOKEN];
    if (!refreshToken) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: MSG.ERROR.REFRESH_TOKEN_NOT_FOUND,
      });
    }

    const tokens = await this.authService.refresh(refreshToken);

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
  @ApiOperation({ summary: 'Logout and clear tokens' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[COOKIE_KEYS.REFRESH_TOKEN];
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    res.clearCookie(COOKIE_KEYS.ACCESS_TOKEN);
    res.clearCookie(COOKIE_KEYS.REFRESH_TOKEN, { path: '/auth/refresh' });

    return { message: MSG.SUCCESS.LOGOUT };
  }

  @Get(E.ME)
  @ApiOperation({ summary: 'Get current authenticated user' })
  getMe(@CurrentUser() user: AuthUser) {
    return user;
  }
}
