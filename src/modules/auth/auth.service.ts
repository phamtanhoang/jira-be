import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, compare } from 'bcryptjs';
import { randomInt, randomUUID } from 'crypto';
import { MSG } from '../../core/constants/message.constant.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';

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
        throw new ConflictException(MSG.EMAIL_ALREADY_REGISTERED);
      }

      const hasValidToken = existing.verificationTokens.some(
        (t) => t.expires > new Date(),
      );

      if (hasValidToken) {
        throw new ConflictException(MSG.EMAIL_PENDING_VERIFICATION);
      }

      // Unverified + all tokens expired → delete and allow re-register
      await this.prisma.user.delete({ where: { id: existing.id } });
    }

    const hashedPassword = await hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hashedPassword,
      },
    });

    const otp = randomInt(100000, 999999).toString();
    const verifyExpiry = parseInt(process.env.TOKEN_VERIFY_EXPIRY!);

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        token: otp,
        expires: new Date(Date.now() + verifyExpiry * 1000),
      },
    });

    await this.mail.sendVerificationEmail(dto.email, otp);

    return { message: MSG.REGISTER_SUCCESS, userId: user.id };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new BadRequestException(MSG.USER_NOT_FOUND);

    const record = await this.prisma.verificationToken.findFirst({
      where: { userId: user.id, token: dto.token },
    });

    if (!record) throw new BadRequestException(MSG.INVALID_VERIFICATION_CODE);
    if (record.expires < new Date()) {
      await this.prisma.verificationToken.delete({
        where: { id: record.id },
      });
      throw new BadRequestException(MSG.VERIFICATION_CODE_EXPIRED);
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

    return { message: MSG.EMAIL_VERIFIED };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !user.password) {
      throw new UnauthorizedException(MSG.INVALID_CREDENTIALS);
    }

    const valid = await compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException(MSG.INVALID_CREDENTIALS);

    if (!user.emailVerified) {
      throw new UnauthorizedException(MSG.EMAIL_NOT_VERIFIED);
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
      throw new UnauthorizedException(MSG.REFRESH_TOKEN_INVALID);
    }

    // Rotate: delete old, create new
    await this.prisma.refreshToken.delete({
      where: { id: record.id },
    });

    const tokens = await this.generateTokens(record.user.id, record.user.email);
    return tokens;
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
    return { message: MSG.LOGOUT_SUCCESS };
  }

  private async generateTokens(userId: string, email: string) {
    const accessExpiry = parseInt(process.env.JWT_ACCESS_TOKEN_EXPIRATION!);
    const refreshExpiry = parseInt(process.env.JWT_REFRESH_TOKEN_EXPIRATION!);

    const accessToken = this.jwt.sign(
      { sub: userId, email },
      { expiresIn: accessExpiry },
    );

    const refreshTokenValue = randomUUID();
    await this.prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId,
        expiresAt: new Date(Date.now() + refreshExpiry * 1000),
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: accessExpiry,
    };
  }
}
