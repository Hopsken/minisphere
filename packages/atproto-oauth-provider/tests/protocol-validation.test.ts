import { describe, expect, it } from "vitest";

import {
  assertAuthorizationServerMetadata,
  assertParResponse,
  assertTokenResponse,
} from "../src/protocol-validation";

const issuer = "https://accounts.example.com";

const validAuthorizationServerMetadata = {
  authorization_endpoint: `${issuer}/oauth/authorize`,
  authorization_response_iss_parameter_supported: true,
  client_id_metadata_document_supported: true,
  code_challenge_methods_supported: ["S256"],
  dpop_signing_alg_values_supported: ["ES256"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  issuer,
  pushed_authorization_request_endpoint: `${issuer}/oauth/par`,
  request_uri_parameter_supported: true,
  require_pushed_authorization_requests: true,
  response_modes_supported: ["fragment", "query"],
  response_types_supported: ["code"],
  revocation_endpoint: `${issuer}/oauth/revoke`,
  revocation_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["atproto", "transition:generic"],
  token_endpoint: `${issuer}/oauth/token`,
  token_endpoint_auth_methods_supported: ["none"],
};

describe("AT Protocol boundary validation", () => {
  it("rejects authorization-server metadata without PAR", () => {
    const { pushed_authorization_request_endpoint: _omitted, ...metadata } =
      validAuthorizationServerMetadata;

    expect(() => assertAuthorizationServerMetadata(metadata)).toThrow(/./u);
  });

  it("rejects a non-expiring PAR response", () => {
    expect(() =>
      assertParResponse({
        expires_in: 0,
        request_uri: "urn:ietf:params:oauth:request_uri:request",
      })
    ).toThrow(/./u);
  });

  it.each([
    ["a bearer token", { token_type: "Bearer" }],
    ["an invalid DID subject", { sub: "not-a-did" }],
  ])("rejects %s in a token response", (_name, replacement) => {
    expect(() =>
      assertTokenResponse({
        access_token: "access-token",
        expires_in: 300,
        scope: "atproto transition:generic",
        sub: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
        token_type: "DPoP",
        ...replacement,
      })
    ).toThrow(/./u);
  });
});
