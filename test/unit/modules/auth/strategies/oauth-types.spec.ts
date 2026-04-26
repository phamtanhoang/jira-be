/**
 * Unit tests for the pure profile-normalizers used by the Google & GitHub
 * passport strategies. These functions are the only place where each
 * provider's quirky Profile shape gets converted to our internal
 * OAuthProfile, so a regression here would mean wrong identity in DB.
 */
import {
  normalizeGithubProfile,
  normalizeGoogleProfile,
  type ProviderProfileLike,
} from '@/modules/auth/strategies/oauth.types';

describe('normalizeGoogleProfile()', () => {
  function profile(
    overrides: Partial<ProviderProfileLike> = {},
  ): ProviderProfileLike {
    return {
      id: 'google-123',
      displayName: 'Alice',
      emails: [{ value: 'alice@example.com' }],
      photos: [{ value: 'https://lh3.googleusercontent.com/avatar.jpg' }],
      ...overrides,
    };
  }

  it('extracts email from emails[0].value', () => {
    expect(normalizeGoogleProfile(profile())).toEqual({
      provider: 'google',
      providerId: 'google-123',
      email: 'alice@example.com',
      name: 'Alice',
      image: 'https://lh3.googleusercontent.com/avatar.jpg',
    });
  });

  it('returns null when email is missing entirely', () => {
    expect(normalizeGoogleProfile(profile({ emails: [] }))).toBeNull();
    expect(normalizeGoogleProfile(profile({ emails: undefined }))).toBeNull();
  });

  it('returns null when emails entry has no value', () => {
    expect(
      normalizeGoogleProfile(profile({ emails: [{ value: undefined }] })),
    ).toBeNull();
  });

  it('falls back to null name when displayName missing', () => {
    expect(
      normalizeGoogleProfile(profile({ displayName: undefined }))?.name,
    ).toBeNull();
  });

  it('falls back to null image when photos missing', () => {
    expect(
      normalizeGoogleProfile(profile({ photos: undefined }))?.image,
    ).toBeNull();
  });

  it('does not touch GitHub _json fallback (only github uses that)', () => {
    const p = profile({
      emails: [],
      _json: { email: 'leak@example.com' },
    });
    expect(normalizeGoogleProfile(p)).toBeNull();
  });
});

describe('normalizeGithubProfile()', () => {
  function profile(
    overrides: Partial<ProviderProfileLike> = {},
  ): ProviderProfileLike {
    return {
      id: 'gh-456',
      displayName: 'Bob',
      username: 'bob42',
      emails: [{ value: 'bob@example.com' }],
      photos: [{ value: 'https://avatars.githubusercontent.com/u/1?v=4' }],
      ...overrides,
    };
  }

  it('extracts email from emails[0].value when present', () => {
    expect(normalizeGithubProfile(profile())).toEqual({
      provider: 'github',
      providerId: 'gh-456',
      email: 'bob@example.com',
      name: 'Bob',
      image: 'https://avatars.githubusercontent.com/u/1?v=4',
    });
  });

  it('falls back to _json.email when emails[] is empty (private email mode)', () => {
    const out = normalizeGithubProfile(
      profile({ emails: [], _json: { email: 'bob+private@example.com' } }),
    );
    expect(out?.email).toBe('bob+private@example.com');
  });

  it('falls back to username when displayName is missing', () => {
    const out = normalizeGithubProfile(profile({ displayName: undefined }));
    expect(out?.name).toBe('bob42');
  });

  it('returns null name when both displayName and username are missing', () => {
    const out = normalizeGithubProfile(
      profile({ displayName: undefined, username: undefined }),
    );
    expect(out?.name).toBeNull();
  });

  it('returns null when both emails[] and _json.email are missing', () => {
    expect(
      normalizeGithubProfile(profile({ emails: [], _json: undefined })),
    ).toBeNull();
  });

  it('preserves the providerId for account linkage downstream', () => {
    expect(normalizeGithubProfile(profile())?.providerId).toBe('gh-456');
  });
});
