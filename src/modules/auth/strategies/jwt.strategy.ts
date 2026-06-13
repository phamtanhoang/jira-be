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

    // Deactivated users keep a valid access token until the 15-min TTL
    // expires. Refresh tokens are wiped on deactivate, but the in-hand
    // access token is not — reject here so admin "deactivate" is
    // effective immediately, not in 15 minutes.
    if (!row.active) throw new UnauthorizedException();

    // Strip the raw password hash and replace with a derived boolean —
    // FE needs to know whether the user has a password (to render the
    // right "Change password" vs "Set password" UX) but must never see
    // the hash itself. `active` is also dropped from the returned shape
    // since AuthUser doesn't expose it.
    const { password, active, ...rest } = row;
    void active;
    return { ...rest, hasPassword: !!password };
  }
}
