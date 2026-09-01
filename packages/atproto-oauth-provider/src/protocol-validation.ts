import {
  atprotoAuthorizationServerMetadataValidator,
  atprotoOAuthScopeSchema,
  atprotoOAuthTokenResponseSchema,
  discoverablePublicClientMetadataSchema,
  loopbackClientMetadataSchema,
  oauthClientMetadataSchema,
  oauthParResponseSchema,
} from "@atcute/oauth-types";
import type { JwksPub } from "@atcute/oauth-types";
import * as v from "valibot";

export type ProtocolJsonValue =
  | boolean
  | null
  | number
  | ProtocolJsonObject
  | ProtocolJsonValue[]
  | string
  | undefined;

export interface ProtocolJsonObject {
  [key: string]: ProtocolJsonValue;
}

export interface PublicClientMetadataDocument {
  application_type?: "native" | "web" | undefined;
  client_id: string;
  client_uri?: string | undefined;
  dpop_bound_access_tokens: true;
  grant_types: string[];
  jwks?: JwksPub | undefined;
  jwks_uri?: string | undefined;
  logo_uri?: string | undefined;
  policy_uri?: string | undefined;
  redirect_uris: string[];
  response_types: string[];
  scope: string;
  token_endpoint_auth_method: "none";
  token_endpoint_auth_signing_alg?: string | undefined;
  tos_uri?: string | undefined;
}

const invalidProtocolValue = (name: string): never => {
  throw new TypeError(`${name} does not match the AT Protocol OAuth profile`);
};

export const parsePublicClientMetadataDocument = (
  input: ProtocolJsonValue
): PublicClientMetadataDocument => {
  const oauthResult = v.safeParse(oauthClientMetadataSchema, input);
  const atprotoResult = v.safeParse(
    discoverablePublicClientMetadataSchema,
    input
  );
  if (!oauthResult.success || !atprotoResult.success) {
    return invalidProtocolValue("Client metadata document");
  }

  const metadata = oauthResult.output;
  if (
    !metadata.client_id ||
    metadata.dpop_bound_access_tokens !== true ||
    !metadata.grant_types?.length ||
    !metadata.response_types?.length ||
    !metadata.scope ||
    metadata.token_endpoint_auth_method !== "none"
  ) {
    return invalidProtocolValue("Client metadata document");
  }

  return {
    application_type: metadata.application_type,
    client_id: metadata.client_id,
    client_uri: metadata.client_uri,
    dpop_bound_access_tokens: true,
    grant_types: metadata.grant_types,
    jwks: metadata.jwks,
    jwks_uri: metadata.jwks_uri,
    logo_uri: metadata.logo_uri,
    policy_uri: metadata.policy_uri,
    redirect_uris: metadata.redirect_uris,
    response_types: metadata.response_types,
    scope: metadata.scope,
    token_endpoint_auth_method: "none",
    token_endpoint_auth_signing_alg: metadata.token_endpoint_auth_signing_alg,
    tos_uri: metadata.tos_uri,
  };
};

export const assertLoopbackClientMetadata = (
  redirectUris: string[],
  scope: string
) => {
  if (
    !v.safeParse(loopbackClientMetadataSchema, {
      redirect_uris: redirectUris,
      scope,
    }).success
  ) {
    invalidProtocolValue("Loopback client metadata");
  }
};

export const parseAtprotoScopes = (value: string) => {
  const result = v.safeParse(atprotoOAuthScopeSchema, value);
  const scopes = value.split(" ");
  if (!result.success || new Set(scopes).size !== scopes.length) {
    return invalidProtocolValue("OAuth scope");
  }
  return scopes;
};

export const assertAuthorizationServerMetadata = (
  input: ProtocolJsonObject
) => {
  if (
    !v.safeParse(atprotoAuthorizationServerMetadataValidator, input).success
  ) {
    invalidProtocolValue("Authorization-server metadata");
  }
};

export const assertParResponse = (input: ProtocolJsonObject) => {
  if (!v.safeParse(oauthParResponseSchema, input).success) {
    invalidProtocolValue("PAR response");
  }
};

export const assertTokenResponse = (input: ProtocolJsonObject) => {
  if (!v.safeParse(atprotoOAuthTokenResponseSchema, input).success) {
    invalidProtocolValue("Token response");
  }
};
