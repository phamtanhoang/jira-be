// Provider-agnostic profile shape that AuthService.loginWithOAuth accepts.
// The two strategy modules normalize their respective passport Profile types
// into this so the service code stays free of provider knowledge.
export type OAuthProvider = 'google' | 'github';

export type OAuthProfile = {
  provider: OAuthProvider;
  providerId: string;
  email: string;
  name: string | null;
  image: string | null;
};

// Minimal subset of passport's Profile shape that we actually consume.
// Pure-function inputs: easier to test than mocking the whole strategy.
export type ProviderProfileLike = {
  id: string;
  displayName?: string;
  username?: string;
  emails?: { value?: string }[];
  photos?: { value?: string }[];
  // GitHub-specific: the raw payload sometimes carries the email here
  // when emails[] is missing.
  _json?: { email?: string };
};

/** Normalizes a Google profile to OAuthProfile. Returns null if no email. */
export function normalizeGoogleProfile(
  profile: ProviderProfileLike,
): OAuthProfile | null {
  const email = profile.emails?.[0]?.value;
  if (!email) return null;
  return {
    provider: 'google',
    providerId: profile.id,
    email,
    name: profile.displayName ?? null,
    image: profile.photos?.[0]?.value ?? null,
  };
}

/** Normalizes a GitHub profile. Falls back to `_json.email` when emails[] is empty. */
export function normalizeGithubProfile(
  profile: ProviderProfileLike,
): OAuthProfile | null {
  const email = profile.emails?.[0]?.value ?? profile._json?.email ?? null;
  if (!email) return null;
  return {
    provider: 'github',
    providerId: profile.id,
    email,
    name: profile.displayName ?? profile.username ?? null,
    image: profile.photos?.[0]?.value ?? null,
  };
}
