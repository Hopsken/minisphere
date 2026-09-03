export interface AtprotoAuthorizationSubject {
  did: string;
  displayName?: string;
  handle?: string;
}

export interface AtprotoAuthorizationDetails {
  clientId: string;
  scope: string;
  subject: AtprotoAuthorizationSubject;
}

export interface AtprotoAccessTokenInput {
  audience: string;
  clientId: string;
  expiresIn: number;
  issuer: string;
  jwkThumbprint: string;
  scope: string;
  subject: string;
}

export interface AtprotoOAuthProviderOptions {
  clientMetadataFetch?: typeof fetch;
  getAccountCompletionUrl: () => Promise<string> | string;
  getAuthorizationSubject: (
    userId: string
  ) =>
    | AtprotoAuthorizationSubject
    | null
    | Promise<AtprotoAuthorizationSubject | null>;
  getAuthorizationPageUrl: (consentToken: string) => Promise<string> | string;
  getJwks: () => Promise<{ keys: JsonWebKey[] }> | { keys: JsonWebKey[] };
  getLoginUrl: (returnTo: string) => Promise<string> | string;
  issuer: string;
  issueAccessToken: (
    input: AtprotoAccessTokenInput
  ) => Promise<string> | string;
  resource: string;
  supportedScopes?: string[];
}

export interface AtprotoClientMetadata {
  applicationType: "native" | "web";
  clientId: string;
  grantTypes: ("authorization_code" | "refresh_token")[];
  redirectUris: string[];
  scopes: string[];
}
