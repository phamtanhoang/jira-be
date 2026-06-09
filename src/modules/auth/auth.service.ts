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

    // Fire-and-forget welcome — never block the verify response. Failure
    // here (SMTP down, provider rate-limit) must not surface as "email not
    // verified" to the user, who genuinely IS verified at this point.
    void this.mail.sendWelcomeEmail(user.email).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`welcome email failed for ${user.email}: ${msg}`);
    });

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
   * OAuth login: matches existing accounts by email so an already-verified
   * password account silently links to its Google/GitHub identity. New
   * users land here with no password — they can set one later via the
   * forgot-password flow (which doubles as "establish a password" for
   * OAuth-only users).
   *
   * Safety rails (match what NextAuth/Auth0/Clerk do):
   *  1. OAuth provider MUST share an email — empty email is rejected so we
   *     never link to / create a `''` user (would collide on next signup).
   *  2. Silent link is REFUSED when an existing password account hasn't
   *     verified its email yet. The unverified row is a stub anyone could
   *     have created; flipping verified=true on OAuth would hand the OAuth
   *     identity to whoever pre-registered. Caller is told to verify the
   *     OTP first.
   *  3. Inactive accounts cannot login via OAuth either — same rule as
   *     password login.
   *
   * Returns extra flags so the controller can fire the appropriate
   * one-shot side effects (welcome email, "we linked Google" notice, audit
   * event) without re-deriving the state from the user row.
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
    if (!profile.email?.trim()) {
      // Happens when a GitHub user keeps their primary email private and
      // hasn't granted `user:email` scope, or any provider that omits email.
      // Without email we cannot safely identify the user — refuse rather
      // than mint an anonymous row.
      throw new BadRequestException(MSG.ERROR.OAUTH_EMAIL_REQUIRED);
    }
    const email = profile.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    let user = existing;
    let wasNewUser = false;

    if (!existing) {
      user = await this.prisma.user.create({
        data: {
          email,
          name: profile.name,
          image: profile.image,
          // OAuth provider already confirmed the email — pre-verify so the
          // user doesn't need to OTP-verify a second time.
          emailVerified: new Date(),
        },
      });
      wasNewUser = true;
    } else if (!existing.active) {
      throw new UnauthorizedException(MSG.ERROR.ACCOUNT_DEACTIVATED);
    } else if (!existing.emailVerified && existing.password) {
      // Pre-registered password stub that never verified. Auto-flipping
      // verified=true here would let the OAuth caller take over an account
      // they didn't create. Force them through OTP verification first.
      throw new UnauthorizedException(MSG.ERROR.OAUTH_VERIFY_EMAIL_FIRST);
    } else if (!existing.emailVerified) {
      // OAuth-only stub (no password) that somehow lost its verified flag.
      // Safe to flip — OAuth itself proves email ownership.
      user = await this.prisma.user.update({
        where: { id: existing.id },
        data: { emailVerified: new Date() },
      });
    }

    let newlyLinkedProvider: 'google' | 'github' | null = null;
    if (user && profile.provider && profile.providerId) {
      // Track whether THIS provider has been linked before — only the FIRST
      // link should fire the "we connected a new account" notification.
      // Use findUnique + branch (instead of upsert) so we can detect insert
      // vs. update without a Prisma return-value heuristic.
      const existingLink = await this.prisma.oAuthAccount.findUnique({
        where: {
          userId_provider: { userId: user.id, provider: profile.provider },
        },
        select: { id: true },
      });

      try {
        if (existingLink) {
          await this.prisma.oAuthAccount.update({
            where: { id: existingLink.id },
            data: {
              providerId: profile.providerId,
              email,
              lastUsedAt: new Date(),
            },
          });
        } else {
          await this.prisma.oAuthAccount.create({
            data: {
              userId: user.id,
              provider: profile.provider,
              providerId: profile.providerId,
              email,
            },
          });
          newlyLinkedProvider = profile.provider;
        }
      } catch (err) {
        // OAuthAccount tracking is supplementary — never block login on it.
        // Worst case: the "Connected accounts" UI is missing a row until
        // the next OAuth sign-in.
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to record OAuthAccount for ${user.id} (${profile.provider}): ${msg}. Continuing login. Run "prisma migrate deploy" to fix.`,
        );
      }
    }

    if (!user) {
      // Should be unreachable — every branch above either assigned `user`
      // or threw. Keep a defensive throw so TS narrows the type.
      throw new UnauthorizedException(MSG.ERROR.INVALID_CREDENTIALS);
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
      wasNewUser,
      newlyLinkedProvider,
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

  /**
   * Handles BOTH cases:
   *  - Change existing password: `user.password` is set → require +
   *    verify `currentPassword`, then update.
   *  - First-time set (OAuth-only user with no password): `user.password`
   *    is null → skip the current-password check, just set the new hash.
   *    The user already proved ownership via OAuth (JWT cookies on the
   *    request), so requiring a password they don't have would lock them
   *    out of ever setting one.
   *
   * Either way, all refresh tokens are revoked afterwards so other
   * sessions forcibly re-authenticate against the new credentials.
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);

    const isFirstTimeSet = !user.password;

    if (!isFirstTimeSet) {
      if (!dto.currentPassword) {
        throw new BadRequestException(MSG.ERROR.CURRENT_PASSWORD_REQUIRED);
      }
      const valid = await validatePassword(dto.currentPassword, user.password!);
      if (!valid) {
        throw new BadRequestException(MSG.ERROR.INVALID_CURRENT_PASSWORD);
      }
    }

    const hashed = await hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: hashed },
      }),
      // Revoke all refresh tokens for safety — both "change" and
      // "first-time set" should force every other device to re-login.
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);

    return {
      message: isFirstTimeSet
        ? MSG.SUCCESS.PASSWORD_SET
        : MSG.SUCCESS.PASSWORD_CHANGED,
      firstTimeSet: isFirstTimeSet,
    };
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
