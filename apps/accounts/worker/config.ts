import { parsePrivateMultikey } from "@atcute/crypto";
import { env } from "cloudflare:workers";
import { z } from "zod";

const httpUrlSchema = z.url({ protocol: /^https?$/u });

const originSchema = httpUrlSchema.refine(
  (value) => URL.canParse(value) && new URL(value).origin === value,
  { message: "Must be an origin without a path" }
);

const privateSecp256k1MultikeySchema = z.string().refine(
  (value) => {
    try {
      return parsePrivateMultikey(value).type === "secp256k1";
    } catch {
      return false;
    }
  },
  { message: "Must be a secp256k1 private multikey" }
);

const optionalOidcValueSchema = z.string().min(1).optional();

const rawConfigSchema = z
  .object({
    ACCOUNTS_OAUTH_SIGNING_KEY: privateSecp256k1MultikeySchema,
    ACCOUNTS_PLC_ROTATION_KEY: privateSecp256k1MultikeySchema,
    BETTER_AUTH_SECRET: z.string().min(32),
    OIDC_CLIENT_ID: optionalOidcValueSchema,
    "OIDC_CLIENT_SE\u0043RET": optionalOidcValueSchema,
    OIDC_DISCOVERY_URL: httpUrlSchema.optional(),
    OIDC_PROVIDER_NAME: z.string().trim().min(1),
    PDS_ORIGIN: originSchema,
    PUBLIC_HANDLE_DOMAIN: z.hostname(),
    PUBLIC_URL: originSchema,
  })
  .superRefine((value, ctx) => {
    const oidcVariables = [
      ["OIDC_CLIENT_ID", value.OIDC_CLIENT_ID],
      ["OIDC_CLIENT_SECRET", value.OIDC_CLIENT_SECRET],
      ["OIDC_DISCOVERY_URL", value.OIDC_DISCOVERY_URL],
    ] as const;
    const configuredCount = oidcVariables.filter(
      ([, configuredValue]) => configuredValue !== undefined
    ).length;

    if (configuredCount === 0 || configuredCount === oidcVariables.length) {
      return;
    }

    for (const [name, configuredValue] of oidcVariables) {
      if (configuredValue === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `${name} is required when OIDC is configured`,
          path: [name],
        });
      }
    }
  });

export const configSchema = rawConfigSchema.transform((value) => ({
  accountsOAuthSigningKey: value.ACCOUNTS_OAUTH_SIGNING_KEY,
  accountsPlcRotationKey: value.ACCOUNTS_PLC_ROTATION_KEY,
  betterAuthSecret: value.BETTER_AUTH_SECRET,
  oidc:
    value.OIDC_CLIENT_ID && value.OIDC_CLIENT_SECRET && value.OIDC_DISCOVERY_URL
      ? {
          clientId: value.OIDC_CLIENT_ID,
          clientSecret: value.OIDC_CLIENT_SECRET,
          discoveryUrl: value.OIDC_DISCOVERY_URL,
          providerName: value.OIDC_PROVIDER_NAME,
        }
      : null,
  pdsOrigin: value.PDS_ORIGIN,
  publicHandleDomain: value.PUBLIC_HANDLE_DOMAIN,
  publicUrl: value.PUBLIC_URL,
}));

export type Config = z.infer<typeof configSchema>;
export type OidcConfig = NonNullable<Config["oidc"]>;

export const configResult = configSchema.safeParse(env);

export const getConfig = (): Config => {
  if (!configResult.success) {
    throw configResult.error;
  }
  return configResult.data;
};
