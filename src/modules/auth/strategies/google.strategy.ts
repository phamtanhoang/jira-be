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
      // CSRF protection — Passport signs a nonce + stores it in the
      // session; the callback rejects mismatched state. Without this,
      // an attacker can pre-craft a callback URL with their own code
      // and silently link an attacker-controlled identity to a victim
      // who happens to click the link while signed in.
      state: true,
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
