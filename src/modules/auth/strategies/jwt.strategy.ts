import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { COOKIE_KEYS, ENV } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { AUTH_USER_SELECT, JwtPayload } from '@/core/types';
import { cookieExtractor } from '@/core/utils';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor(COOKIE_KEYS.ACCESS_TOKEN),
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: ENV.JWT_SECRET,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: AUTH_USER_SELECT,
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
