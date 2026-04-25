import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ENV } from '@/core/constants';
import { MailModule } from '@/core/mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GithubStrategy } from './strategies/github.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

// OAuth strategies always register, but each constructor falls back to
// placeholder credentials when its env vars are unset. The provider then
// rejects token exchange — the app boots fine and the routes return a
// helpful redirect with `?error=oauth_failed` instead of crashing.
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: ENV.JWT_SECRET,
      signOptions: {
        expiresIn: ENV.JWT_ACCESS_TOKEN_EXPIRATION,
      },
    }),
    MailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy, GithubStrategy],
})
export class AuthModule {}
