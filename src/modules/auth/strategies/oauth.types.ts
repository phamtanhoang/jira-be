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
