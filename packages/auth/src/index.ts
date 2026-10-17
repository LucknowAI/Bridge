export {
  getAuthConfig,
  getSessionConfig,
  getOtpConfig,
  type AuthConfig,
  type SessionConfig,
  type OtpConfig,
} from "./config";

export {
  sealSession,
  unsealSession,
  sessionCookieOptions,
  sealOAuthState,
  unsealOAuthState,
  OAUTH_COOKIE_NAME,
  OAUTH_COOKIE_MAX_AGE,
  type Session,
  type OAuthState,
} from "./session";

export {
  discover,
  createPkce,
  randomUrlSafe,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  verifyIdToken,
  buildLogoutUrl,
  ensureUser,
  findUserByEmail,
  resetCaches,
  type Pkce,
  type TokenSet,
  type IdTokenClaims,
} from "./keycloak";

export {
  CODE_LENGTH,
  generateCode,
  generateToken,
  hashSecret,
  issueChallenge,
  verifyCode,
  verifyToken,
  RateLimitError,
  type IssuedChallenge,
  type VerifyResult,
  type VerifyFailure,
} from "./otp";
