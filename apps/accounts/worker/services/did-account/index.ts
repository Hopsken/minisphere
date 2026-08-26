import { ComAtprotoServerCreateAccount } from "@atcute/atproto";
import { HTTPException } from "hono/http-exception";

import type { PdsClient } from "../../clients/pds-client";
import type { Auth } from "../../lib/better-auth";

export class DidAccountService {
  private auth: Auth;
  private pdsClient: PdsClient;

  constructor(auth: Auth, pdsClient: PdsClient) {
    this.auth = auth;
    this.pdsClient = pdsClient;
  }

  private static createAtProtoHandle(env: Env, username: string) {
    const handleDomain = env.PUBLIC_HANDLE_DOMAIN;

    const handle: `${string}.${string}` = `${username}.${handleDomain}`;
    const email = `${username}@${handleDomain}`;

    return { email, handle };
  }

  async createDidAccount(env: Env, username: string) {
    const { auth } = this;

    const { email, handle } = DidAccountService.createAtProtoHandle(
      env,
      username
    );

    const authContext = await auth.$context;
    const [{ available }, existingUser] = await Promise.all([
      auth.api.isUsernameAvailable({ body: { username } }),
      authContext.internalAdapter.findUserByEmail(email),
    ]);

    if (!available || existingUser) {
      throw new HTTPException(409, { message: "Username is taken" });
    }

    const newUser = await authContext.internalAdapter.createUser(
      {
        email,
        emailVerified: true,
        name: username,
        username,
      },
      { method: "email-password" }
    );

    const didAccount = await this.registerDidAccount(env, newUser.id, handle);

    return {
      ...newUser,
      ...didAccount,
    };
  }

  private async registerDidAccount(
    env: Env,
    userId: string,
    handle: `${string}.${string}`
  ) {
    const { pdsClient, auth } = this;

    const authContext = await auth.$context;

    const inviteCode = await env.PDS.generateInviteCode();
    const response = await pdsClient.call(ComAtprotoServerCreateAccount, {
      input: {
        handle,
        inviteCode,
      },
    });

    if (!response.ok) {
      throw new HTTPException(400, {
        cause: response.data.error,
        message: response.data.message ?? "PDS Error",
      });
    }

    const { did } = response.data;
    await authContext.internalAdapter.updateUser(userId, {
      did,
    });

    return { did, handle };
  }
}
