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
import { CurrentUser } from '../../core/decorators/current-user.decorator.js';
import { Public } from '../../core/decorators/public.decorator.js';
import {
  COOKIE_KEYS,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
} from '../../core/constants/cookie.constant.js';
import { MSG } from '../../core/constants/message.constant.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email with 6-digit OTP' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Public()
  @Post('login')
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
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[COOKIE_KEYS.REFRESH_TOKEN];
    if (!refreshToken) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: MSG.REFRESH_TOKEN_NOT_FOUND,
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

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and clear tokens' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[COOKIE_KEYS.REFRESH_TOKEN];
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    res.clearCookie(COOKIE_KEYS.ACCESS_TOKEN);
    res.clearCookie(COOKIE_KEYS.REFRESH_TOKEN, { path: '/auth/refresh' });

    return { message: MSG.LOGOUT_SUCCESS };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user' })
  getMe(@CurrentUser() user: any) {
    return user;
  }
}
