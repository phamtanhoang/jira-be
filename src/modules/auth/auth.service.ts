import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ENV,
  MSG,
  UPLOAD_LIMITS,
  USER_SELECT_FULL,
  isAllowedMime,
} from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { MailService } from '@/core/mail/mail.service';
import {
  calculateExpiryDate,
  deleteFile,
  generateOTP,
  generateRefreshToken,
  hashPassword,
  uploadFile,
  validatePassword,
} from '@/core/utils';
import { AdminAuditService } from '@/modules/admin-audit/admin-audit.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private mail: MailService,
    private audit: AdminAuditService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { verificationTokens: true },
    });

    if (existing) {
      if (existing.emailVerified) {
        throw new ConflictException(MSG.ERROR.EMAIL_ALREADY_REGISTERED);
      }

      const hasValidToken = existing.verificationTokens.some(
        (t) => t.expires > new Date(),
      );

      if (hasValidToken) {
        throw new ConflictException(MSG.ERROR.EMAIL_PENDING_VERIFICATION);
      }

      // Unverified + all tokens expired → delete and allow re-register
      await this.prisma.user.delete({ where: { id: existing.id } });
    }

    const hashedPassword = await hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hashedPassword,
      },
    });

    const otp = generateOTP();

    // Token row + verification email are independent of each other —
    // run them in parallel to shave ~30-50ms off the register response.
    // Mail send wraps its own try/catch and never throws.
    await Promise.all([
      this.prisma.verificationToken.create({
        data: {
          userId: user.id,
          token: otp,
          expires: calculateExpiryDate(ENV.TOKEN_VERIFY_EXPIRY),
        },
      }),
      this.mail.sendVerificationEmail(dto.email, otp),
    ]);

    return {
      message: MSG.SUCCESS.REGISTER,
      userId: user.id,
      otpExpiresIn: ENV.TOKEN_VERIFY_EXPIRY,
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new BadRequestException(MSG.ERROR.USER_NOT_FOUND);

    const record = await this.prisma.verificationToken.findFirst({
      where: { userId: user.id, token: dto.token },
    });

    if (!record)
      throw new BadRequestException(MSG.ERROR.INVALID_VERIFICATION_CODE);
    if (record.expires < new Date()) {
      await this.prisma.verificationToken.delete({
        where: { id: record.id },
      });
      throw new BadRequestException(MSG.ERROR.VERIFICATION_CODE_EXPIRED);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      }),
      this.prisma.verificationToken.deleteMany({
        where: { userId: user.id },
      }),
    ]);

    return { message: MSG.SUCCESS.EMAIL_VERIFIED };
  }

  async login(dto: LoginDto, meta?: SessionMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !user.password) {
      throw new UnauthorizedException(MSG.ERROR.INVALID_CREDENTIALS);
    }

    const valid = await validatePassword(dto.password, user.password);
    if (!valid) throw new UnauthorizedException(MSG.ERROR.INVALID_CREDENTIALS);

    if (!user.emailVerified) {
      throw new UnauthorizedException(MSG.ERROR.EMAIL_NOT_VERIFIED);
    }

    if (!user.active) {
      throw new UnauthorizedException(MSG.ERROR.ACCOUNT_DEACTIVATED);
    }

    const tokens = await this.generateTokens(user.id, user.email, meta);
    return {
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
      },
    };
  }

  /**
   * OAuth login: upsert by email so an existing password account silently
   * links to the same user when they SSO with the matching email. New users
   * land here with no password (Google/GitHub becomes their only sign-in
   * method until they set one via password reset).
   */
  async loginWithOAuth(
    profile: {
      email: string;
      name: string | null;
      image: string | null;
      provider?: 'google' | 'github';
      providerId?: string;
    },
    meta?: SessionMeta,
  ) {
    const email = profile.email.toLowerCase();
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          name: profile.name,
          image: profile.image,
          // OAuth-issued accounts are pre-verified — the provider already
          // confirmed the email.
          emailVerified: new Date(),
        },
      });
    } else if (!user.active) {
      throw new UnauthorizedException(MSG.ERROR.ACCOUNT_DEACTIVATED);
    } else if (!user.emailVerified) {
      // Existing account still pending email-OTP verification: the OAuth
      // success itself proves email ownership, so flip the flag now.
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    }

    if (profile.provider && profile.providerId) {
      // Recording the linked OAuth account is supplementary — it powers the
      // /profile "Connected accounts" UI but isn't required to issue tokens.
      // Swallow failures so an out-of-date schema (missing OAuthAccount table)
      // can't block users from logging in. The error is logged for the admin.
      try {
        await this.prisma.oAuthAccount.upsert({
          where: {
            userId_provider: { userId: user.id, provider: profile.provider },
          },
          update: {
            providerId: profile.providerId,
            email,
            lastUsedAt: new Date(),
          },
          create: {
            userId: user.id,
            provider: profile.provider,
            providerId: profile.providerId,
            email,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to record OAuthAccount for ${user.id} (${profile.provider}): ${msg}. Continuing login. Run "prisma migrate deploy" to fix.`,
        );
      }
    }

    const tokens = await this.generateTokens(user.id, user.email, meta);
    return {
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
      },
    };
  }

  async listOAuthAccounts(userId: string) {
    const rows = await this.prisma.oAuthAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        provider: true,
        email: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    return rows;
  }

  /**
   * Unlink an OAuth provider. Refuse the unlink if the user would otherwise
   * be locked out — i.e. has no password set and no other OAuth account.
   */
  async unlinkOAuthAccount(userId: string, provider: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });
    if (!user) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);

    const accounts = await this.prisma.oAuthAccount.findMany({
      where: { userId },
      select: { provider: true },
    });
    const target = accounts.find((a) => a.provider === provider);
    if (!target) {
      throw new NotFoundException(MSG.ERROR.OAUTH_ACCOUNT_NOT_FOUND);
    }
    if (!user.password && accounts.length <= 1) {
      throw new BadRequestException(MSG.ERROR.OAUTH_LAST_LOGIN_METHOD);
    }

    await this.prisma.oAuthAccount.delete({
      where: { userId_provider: { userId, provider } },
    });
    return { message: MSG.SUCCESS.OAUTH_ACCOUNT_UNLINKED };
  }

  async refresh(oldRefreshToken: string, meta?: SessionMeta) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { token: oldRefreshToken },
      include: { user: true },
    });

    if (!record || record.expiresAt < new Date()) {
      if (record) {
        await this.prisma.refreshToken.delete({
          where: { id: record.id },
        });
      }
      throw new UnauthorizedException(MSG.ERROR.REFRESH_TOKEN_INVALID);
    }

    // Rotate: delete old, create new. Carry the device metadata from the old
    // row forward unless the request supplies something fresher — prevents
    // refresh-on-new-network from silently erasing "original device" info.
    await this.prisma.refreshToken.delete({
      where: { id: record.id },
    });

    const mergedMeta: SessionMeta = {
      userAgent: meta?.userAgent ?? record.userAgent ?? undefined,
      ip: meta?.ip ?? record.ip ?? undefined,
    };

    const tokens = await this.generateTokens(
      record.user.id,
      record.user.email,
      mergedMeta,
    );
    return tokens;
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !user.emailVerified) {
      throw new BadRequestException(MSG.ERROR.USER_NOT_FOUND);
    }

    // Delete old tokens before creating new one
    await this.prisma.verificationToken.deleteMany({
      where: { userId: user.id },
    });

    const otp = generateOTP();

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        token: otp,
        expires: calculateExpiryDate(ENV.TOKEN_VERIFY_EXPIRY),
      },
    });

    await this.mail.sendResetPasswordEmail(dto.email, otp);

    return {
      message: MSG.SUCCESS.FORGOT_PASSWORD,
      otpExpiresIn: ENV.TOKEN_VERIFY_EXPIRY,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new BadRequestException(MSG.ERROR.USER_NOT_FOUND);

    const record = await this.prisma.verificationToken.findFirst({
      where: { userId: user.id, token: dto.token },
    });

    if (!record)
      throw new BadRequestException(MSG.ERROR.INVALID_VERIFICATION_CODE);
    if (record.expires < new Date()) {
      await this.prisma.verificationToken.delete({
        where: { id: record.id },
      });
      throw new BadRequestException(MSG.ERROR.VERIFICATION_CODE_EXPIRED);
    }

    const hashedPassword = await hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      }),
      this.prisma.verificationToken.deleteMany({
        where: { userId: user.id },
      }),
    ]);

    return { message: MSG.SUCCESS.RESET_PASSWORD };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name.trim();
    if (dto.image !== undefined) updates.image = dto.image;

    if (Object.keys(updates).length === 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        ...USER_SELECT_FULL,
      });
      return { message: MSG.SUCCESS.PROFILE_UPDATED, user };
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: updates,
      ...USER_SELECT_FULL,
    });

    return { message: MSG.SUCCESS.PROFILE_UPDATED, user };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password) {
      throw new BadRequestException(MSG.ERROR.USER_NOT_FOUND);
    }

    const valid = await validatePassword(dto.currentPassword, user.password);
    if (!valid) {
      throw new BadRequestException(MSG.ERROR.INVALID_CURRENT_PASSWORD);
    }

    const hashed = await hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: hashed },
      }),
      // Revoke all refresh tokens for safety
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);

    return { message: MSG.SUCCESS.PASSWORD_CHANGED };
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(MSG.ERROR.INVALID_IMAGE_TYPE);
    }
    if (!isAllowedMime(UPLOAD_LIMITS.AVATAR, file.mimetype)) {
      throw new BadRequestException(MSG.ERROR.INVALID_IMAGE_TYPE);
    }
    if (file.size > UPLOAD_LIMITS.AVATAR.maxSize) {
      throw new BadRequestException(MSG.ERROR.IMAGE_TOO_LARGE);
    }

    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });

    const fileUrl = await uploadFile(
      file.buffer,
      `avatar-${userId}-${file.originalname}`,
      file.mimetype,
    );

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { image: fileUrl },
      ...USER_SELECT_FULL,
    });

    // Best-effort cleanup of the previous avatar
    if (existing?.image) {
      try {
        await deleteFile(existing.image);
      } catch {
        // Ignore — stale avatar cleanup shouldn't fail the upload
      }
    }

    this.audit.log(userId, 'AVATAR_UPDATE', {
      target: userId,
      targetType: 'User',
      payload: {
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
      },
    });

    return { message: MSG.SUCCESS.AVATAR_UPLOADED, user };
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
    return { message: MSG.SUCCESS.LOGOUT };
  }

  // ─── My sessions ─────────────────────────────────────

  /**
   * Returns active (not yet expired) sessions for the current user. The
   * session matching `currentToken` is flagged with `isCurrent: true` so the
   * FE can highlight "this device". Raw token strings are never returned.
   */
  async listMySessions(userId: string, currentToken: string | null) {
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
        userAgent: true,
        ip: true,
        token: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => {
      const { token, ...rest } = s;
      return { ...rest, isCurrent: token === currentToken };
    });
  }

  async revokeMySession(
    userId: string,
    sessionId: string,
    currentToken: string | null,
  ): Promise<boolean> {
    const session = await this.prisma.refreshToken.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, token: true },
    });
    if (!session || session.userId !== userId) {
      throw new NotFoundException(MSG.ERROR.REFRESH_TOKEN_NOT_FOUND);
    }
    await this.prisma.refreshToken.delete({ where: { id: sessionId } });
    return session.token === currentToken;
  }

  async revokeOtherSessions(
    userId: string,
    currentToken: string | null,
  ): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: {
        userId,
        ...(currentToken ? { token: { not: currentToken } } : {}),
      },
    });
    return result.count;
  }

  async revokeAllMySessions(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });
    return result.count;
  }

  private async generateTokens(
    userId: string,
    email: string,
    meta?: SessionMeta,
  ) {
    const accessExpiry = ENV.JWT_ACCESS_TOKEN_EXPIRATION;
    const refreshExpiry = ENV.JWT_REFRESH_TOKEN_EXPIRATION;

    const accessToken = this.jwt.sign(
      { sub: userId, email },
      { expiresIn: accessExpiry },
    );

    const refreshTokenValue = generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId,
        expiresAt: calculateExpiryDate(refreshExpiry),
        userAgent: meta?.userAgent?.slice(0, 512),
        ip: meta?.ip,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: accessExpiry,
    };
  }
}

export type SessionMeta = {
  userAgent?: string;
  ip?: string;
};
