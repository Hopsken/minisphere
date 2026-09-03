import type { AtprotoClientMetadata } from "./types";

export const ACCESS_TOKEN_LIFETIME_SECONDS = 5 * 60;
export const AUTHORIZATION_CODE_LIFETIME_MS = 60 * 1000;
export const AUTHORIZATION_INTERACTION_LIFETIME_MS = 10 * 60 * 1000;
export const DPOP_NONCE_LIFETIME_MS = 5 * 60 * 1000;
export const PAR_LIFETIME_MS = 5 * 60 * 1000;
export const PKCE_REPLAY_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
export const REQUEST_URI_PREFIX = "urn:ietf:params:oauth:request_uri:";

export interface AuthorizationRequest {
  clientId: string;
  codeChallenge: string;
  loginHint?: string;
  metadata: AtprotoClientMetadata;
  redirectUri: string;
  responseMode: "fragment" | "query";
  scope: string[];
  state: string;
}

export interface ConsentRecord {
  jwkThumbprint: string;
  request: AuthorizationRequest;
  subjectDid: string;
  userId: string;
}

export interface AuthorizationCodeRecord {
  did: string;
  jwkThumbprint: string;
  request: AuthorizationRequest;
}

export interface OAuthSessionRecord {
  clientId: string;
  did: string;
  expiresAt: number;
  jwkThumbprint: string;
  scope: string[];
}

export interface SessionTokenRecord {
  sessionId: string;
}

export interface IssuedTokenSet {
  accessToken: string;
  refreshToken?: string;
}
