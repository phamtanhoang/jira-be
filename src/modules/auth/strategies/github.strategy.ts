import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-github2';
import { ENV } from '@/core/constants';
import { normalizeGithubProfile, type OAuthProfile } from './oauth.types';

const ID = ENV.GITHUB_CLIENT_ID || 'unconfigured';
const SECRET = ENV.GITHUB_CLIENT_SECRET || 'unconfigured';
const CALLBACK =
  ENV.GITHUB_CALLBACK_URL || 'http://localhost:4000/auth/github/callback';

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
    const out = normalizeGithubProfile(profile);
    if (!out) {
      this.logger.warn(`GitHub profile ${profile.id} missing email`);
      return done(new Error('NO_EMAIL'), false);
    }
    done(null, out);
  }
}

export const isGithubConfigured = () => Boolean(ENV.GITHUB_CLIENT_ID);
