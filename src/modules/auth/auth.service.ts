import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ENV, MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { MailService } from '@/core/mail/mail.service';
import {
  calculateExpiryDate,
  generateOTP,
  generateRefreshToken,
  hashPassword,
  validatePassword,
} from '@/core/utils';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private mail: MailService,
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

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        token: otp,
        expires: calculateExpiryDate(ENV.TOKEN_VERIFY_EXPIRY),
      },
    });

    await this.mail.sendVerificationEmail(dto.email, otp);

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

  async login(dto: LoginDto) {
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

    const tokens = await this.generateTokens(user.id, user.email);
    return tokens;
  }

  async refresh(oldRefreshToken: string) {
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

    // Rotate: delete old, create new
    await this.prisma.refreshToken.delete({
      where: { id: record.id },
    });

    const tokens = await this.generateTokens(record.user.id, record.user.email);
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

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
    return { message: MSG.SUCCESS.LOGOUT };
  }

  private async generateTokens(userId: string, email: string) {
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
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: accessExpiry,
    };
  }
}
