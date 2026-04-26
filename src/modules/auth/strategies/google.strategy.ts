import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  type Profile,
  type VerifyCallback,
} from 'passport-google-oauth20';
import { ENV } from '@/core/constants';
import { normalizeGoogleProfile } from './oauth.types';

// Lazy guard: when no client ID is configured the strategy still constructs
// (Passport requires it at module init), but we feed dummy creds so Google
// rejects token exchange — keeps the route harmless rather than crashing
// the boot process.
const ID = ENV.GOOGLE_CLIENT_ID || 'unconfigured';
const SECRET = ENV.GOOGLE_CLIENT_SECRET || 'unconfigured';
const CALLBACK =
  ENV.GOOGLE_CALLBACK_URL || 'http://localhost:4000/auth/google/callback';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor() {
    super({
      clientID: ID,
      clientSecret: SECRET,
      callbackURL: CALLBACK,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    const out = normalizeGoogleProfile(profile);
    if (!out) {
      this.logger.warn('Google profile missing email — rejecting');
      return done(new Error('NO_EMAIL'), false);
    }
    done(null, out);
  }
}

export const isGoogleConfigured = () => Boolean(ENV.GOOGLE_CLIENT_ID);
