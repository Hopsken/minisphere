export interface AtprotoAuthorizationSubject {
  did: string;
  displayName?: string;
  handle?: string;
}

export interface AtprotoAuthorizationPageInput {
  clientId: string;
  consentToken: string;
  scope: string;
  subjects: AtprotoAuthorizationSubject[];
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
  getAuthorizationSubjects: (
    userId: string
  ) => AtprotoAuthorizationSubject[] | Promise<AtprotoAuthorizationSubject[]>;
  getLoginUrl: (returnTo: string) => Promise<string> | string;
  isAuthorizedSubject: (
    userId: string,
    did: string
  ) => Promise<boolean> | boolean;
  issuer: string;
  issueAccessToken: (
    input: AtprotoAccessTokenInput
  ) => Promise<string> | string;
  renderAuthorizationPage: (
    input: AtprotoAuthorizationPageInput
  ) => Promise<Response> | Response;
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
