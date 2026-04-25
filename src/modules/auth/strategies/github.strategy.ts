import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-github2';
import { ENV } from '@/core/constants';
import type { OAuthProfile } from './oauth.types';

const ID = ENV.GITHUB_CLIENT_ID || 'unconfigured';
const SECRET = ENV.GITHUB_CLIENT_SECRET || 'unconfigured';
const CALLBACK = ENV.GITHUB_CALLBACK_URL || 'http://localhost:4000/auth/github/callback';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  private readonly logger = new Logger(GithubStrategy.name);

  constructor() {
    super({
      clientID: ID,
      clientSecret: SECRET,
      callbackURL: CALLBACK,
      // user:email so GitHub returns even private email addresses
      scope: ['user:email'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: (err: Error | null, profile?: OAuthProfile | false) => void,
  ) {
    // GitHub may return primary email in either `emails[0].value` or in the
    // `_json.email` field; private accounts may have neither — caller will
    // need to ask the user to attach an email.
    const email =
      profile.emails?.[0]?.value ??
      ((profile as { _json?: { email?: string } })._json?.email ?? null);
    if (!email) {
      this.logger.warn(`GitHub profile ${profile.id} missing email`);
      return done(new Error('NO_EMAIL'), false);
    }
    const out: OAuthProfile = {
      provider: 'github',
      providerId: profile.id,
      email,
      name: profile.displayName ?? profile.username ?? null,
      image: profile.photos?.[0]?.value ?? null,
    };
    done(null, out);
  }
}

export const isGithubConfigured = () => Boolean(ENV.GITHUB_CLIENT_ID);
