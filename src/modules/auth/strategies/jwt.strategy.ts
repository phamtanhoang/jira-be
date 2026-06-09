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
    const row = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: AUTH_USER_SELECT,
    });
    if (!row) throw new UnauthorizedException();

    // Strip the raw password hash and replace with a derived boolean —
    // FE needs to know whether the user has a password (to render the
    // right "Change password" vs "Set password" UX) but must never see
    // the hash itself.
    const { password, ...rest } = row;
    return { ...rest, hasPassword: !!password };
  }
}
