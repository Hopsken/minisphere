import { isDid } from "@atcute/lexicons/syntax";
import { z } from "zod";

import type { PlcDirectoryClient } from "../clients/plc-directory-client";
import { resolveConfig } from "../config";
import { createHostedHandle } from "../lib/hosted-handle";
import { signJwt, verifyJwt } from "../lib/jwt";
import { XrpcError } from "../lib/xrpc-error";
import type { AppPasswordRepository } from "../repositories/app-password-repository";
import type { UserRepository } from "../repositories/user-repository";
import { hashAppPassword } from "./app-passwords";
import { OAuthSigningKeys } from "./oauth-signing-keys";

// The PDS rejects access tokens that live longer than five minutes.
const ACCESS_TOKEN_LIFETIME_SECONDS = 5 * 60;
const REFRESH_TOKEN_LIFETIME_SECONDS = 90 * 24 * 60 * 60;
// A rotated refresh token keeps working briefly, so a client that lost the
// refresh response can retry and receive the same successor.
const REFRESH_TOKEN_GRACE_SECONDS = 2 * 60 * 60;

const accessScopes = [
  "com.atproto.appPass",
  "com.atproto.appPassPrivileged",
] as const;

const didSchema = z.string().refine(isDid, { message: "sub must be a DID" });

const refreshClaimsSchema = (issuer: string) =>
  z.strictObject({
    aud: z.literal(issuer),
    exp: z.number().int(),
    iat: z.number().int(),
    iss: z.literal(issuer),
    jti: z.string().min(1),
    scope: z.literal("com.atproto.refresh"),
    sub: didSchema,
  });

const accessClaimsSchema = (issuer: string, audience: string) =>
  z.strictObject({
    aud: z.literal(audience),
    exp: z.number().int(),
    iat: z.number().int(),
    iss: z.literal(issuer),
    jti: z.string().min(1),
    scope: z.enum(accessScopes),
    sub: didSchema,
  });

const invalidToken = () =>
  new XrpcError(400, "ExpiredToken", "Token has expired or been revoked");

const now = () => Math.floor(Date.now() / 1000);

const isPlcDid = (did: string): did is `did:plc:${string}` =>
  did.startsWith("did:plc:");

/** The `com.atproto.server.getSession` output. */
interface SessionDescription {
  active: true;
  did: string;
  didDoc?: Awaited<ReturnType<PlcDirectoryClient["getDocument"]>>;
  email: string;
  emailConfirmed: boolean;
  handle: string;
}

type Account = NonNullable<
  Awaited<ReturnType<UserRepository["findActiveAccount"]>>
>;

/**
 * Legacy `com.atproto.server.*Session` sessions authenticated by app
 * passwords. Tokens are signed with the key published in the OAuth JWKS; the
 * PDS accepts the access token as a Bearer credential.
 */
export class AppPasswordSessions {
  private readonly users: UserRepository;
  private readonly appPasswords: AppPasswordRepository;
  private readonly plc: PlcDirectoryClient;
  private readonly keys = new OAuthSigningKeys();

  constructor(
    users: UserRepository,
    appPasswords: AppPasswordRepository,
    plc: PlcDirectoryClient
  ) {
    this.users = users;
    this.appPasswords = appPasswords;
    this.plc = plc;
  }

  async create(identifier: string, password: string) {
    const account = await this.findAccount(identifier);
    const appPassword = account
      ? await this.appPasswords.findByHash(
          account.userId,
          await hashAppPassword(password)
        )
      : undefined;
    if (!account || !appPassword) {
      throw new XrpcError(
        401,
        "AuthenticationRequired",
        "Invalid identifier or password"
      );
    }
    const refreshToken = await this.appPasswords.createRefreshToken(
      appPassword.id,
      now() + REFRESH_TOKEN_LIFETIME_SECONDS
    );
    return this.issue(account, appPassword.privileged, refreshToken);
  }

  async refresh(refreshJwt: string) {
    const claims = await this.verifyRefreshToken(refreshJwt, false);
    const token = await this.appPasswords.findRefreshToken(claims.jti, now());
    const account = token
      ? await this.users.findActiveAccount({ userId: token.userId })
      : undefined;
    if (!token || account?.did !== claims.sub) {
      throw invalidToken();
    }
    if (!token.nextId) {
      await this.appPasswords.rotateRefreshToken(
        token.id,
        {
          expiresAt: now() + REFRESH_TOKEN_LIFETIME_SECONDS,
          id: crypto.randomUUID(),
        },
        now() + REFRESH_TOKEN_GRACE_SECONDS
      );
    }
    // Read the successor back: a concurrent rotation may have chosen it.
    const rotated = await this.appPasswords.findRefreshToken(token.id, now());
    const next = rotated?.nextId
      ? await this.appPasswords.findRefreshToken(rotated.nextId, now())
      : undefined;
    if (!next) {
      throw invalidToken();
    }
    return this.issue(account, next.privileged, next);
  }

  async get(accessJwt: string) {
    const { accountsOrigin, pdsOrigin } = resolveConfig();
    const claims = await verifyJwt(
      accessJwt,
      "at+jwt",
      accessClaimsSchema(
        accountsOrigin,
        `did:web:${new URL(pdsOrigin).hostname}`
      ),
      (kid) => this.keys.isPublished(kid)
    ).catch(() => null);
    const account =
      claims && claims.exp > now()
        ? await this.users.findActiveAccount({ did: claims.sub })
        : undefined;
    if (!account) {
      throw invalidToken();
    }
    return this.describe(account);
  }

  async delete(refreshJwt: string) {
    const claims = await this.verifyRefreshToken(refreshJwt, true);
    await this.appPasswords.deleteRefreshToken(claims.jti);
  }

  private findAccount(input: string) {
    const identifier = input.trim().toLowerCase().replace(/^@/u, "");
    if (identifier.startsWith("did:")) {
      return this.users.findActiveAccount({ did: identifier });
    }
    if (identifier.includes("@")) {
      return this.users.findActiveAccount({ email: identifier });
    }
    const suffix = `.${resolveConfig().handleDomain.toLowerCase()}`;
    const username = identifier.endsWith(suffix)
      ? identifier.slice(0, -suffix.length)
      : identifier;
    if (!username || username.includes(".")) {
      return null;
    }
    return this.users.findActiveAccount({ username });
  }

  private async verifyRefreshToken(token: string, allowExpired: boolean) {
    const { accountsOrigin } = resolveConfig();
    const claims = await verifyJwt(
      token,
      "refresh+jwt",
      refreshClaimsSchema(accountsOrigin),
      (kid) => this.keys.isPublished(kid)
    ).catch(() => null);
    if (!claims || (!allowExpired && claims.exp <= now())) {
      throw invalidToken();
    }
    return claims;
  }

  private async issue(
    account: Account,
    privileged: boolean,
    refreshToken: { expiresAt: number; id: string }
  ) {
    const { accountsOrigin, pdsOrigin } = resolveConfig();
    const key = await this.keys.getCurrentKey();
    const issuedAt = now();
    const [accessJwt, refreshJwt, session] = await Promise.all([
      signJwt(key, "at+jwt", {
        aud: `did:web:${new URL(pdsOrigin).hostname}`,
        exp: issuedAt + ACCESS_TOKEN_LIFETIME_SECONDS,
        iat: issuedAt,
        iss: accountsOrigin,
        jti: crypto.randomUUID(),
        scope: privileged ? accessScopes[1] : accessScopes[0],
        sub: account.did,
      }),
      signJwt(key, "refresh+jwt", {
        aud: accountsOrigin,
        exp: refreshToken.expiresAt,
        iat: issuedAt,
        iss: accountsOrigin,
        jti: refreshToken.id,
        scope: "com.atproto.refresh",
        sub: account.did,
      }),
      this.describe(account),
    ]);
    return { accessJwt, refreshJwt, ...session };
  }

  private async describe(account: Account) {
    const { handleDomain } = resolveConfig();
    // Clients route requests to the PDS named in the DID document. Without it,
    // they fall back to the service they signed in to, so this is best effort.
    const session: SessionDescription = {
      active: true,
      did: account.did,
      email: account.email,
      emailConfirmed: account.emailVerified,
      handle: createHostedHandle(account.username, handleDomain),
    };
    if (isPlcDid(account.did)) {
      try {
        session.didDoc = await this.plc.getDocument(account.did);
      } catch {
        // Omit the document; clients keep using the service they signed in to.
      }
    }
    return session;
  }
}
