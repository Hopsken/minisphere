import { SignJWT } from "jose";

const ACCESS_TOKEN_LIFETIME_SECONDS = 2 * 60 * 60;
const REFRESH_TOKEN_LIFETIME_SECONDS = 90 * 24 * 60 * 60;
const SESSION_SECRET_MIN_BYTES = 32;

const textEncoder = new TextEncoder();

export interface SessionTokens {
  accessJwt: string;
  refreshJwt: string;
  refreshToken: {
    expiresAt: number;
    jti: string;
  };
}

export const createSessionTokens = async (
  did: string,
  audience: string,
  secret: string,
  now = Math.floor(Date.now() / 1000)
): Promise<SessionTokens> => {
  const secretBytes = textEncoder.encode(secret);
  if (secretBytes.length < SESSION_SECRET_MIN_BYTES) {
    throw new Error("PDS_JWT_SECRET must contain at least 32 bytes");
  }

  const refreshJti = crypto.randomUUID();
  const refreshExpiresAt = now + REFRESH_TOKEN_LIFETIME_SECONDS;

  const [accessJwt, refreshJwt] = await Promise.all([
    new SignJWT({ scope: "com.atproto.access" })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setAudience(audience)
      .setSubject(did)
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TOKEN_LIFETIME_SECONDS)
      .sign(secretBytes),
    new SignJWT({ scope: "com.atproto.refresh" })
      .setProtectedHeader({ alg: "HS256", typ: "refresh+jwt" })
      .setAudience(audience)
      .setSubject(did)
      .setJti(refreshJti)
      .setIssuedAt(now)
      .setExpirationTime(refreshExpiresAt)
      .sign(secretBytes),
  ]);

  return {
    accessJwt,
    refreshJwt,
    refreshToken: { expiresAt: refreshExpiresAt, jti: refreshJti },
  };
};
