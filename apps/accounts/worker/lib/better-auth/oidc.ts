import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { z } from "zod";

import type { Config } from "../../config";

const oidcProfileSchema = z.looseObject({
  name: z.string().trim().optional(),
  preferred_username: z.string().trim().optional(),
  sub: z.union([z.string(), z.number()]),
});

type OidcProfile = z.infer<typeof oidcProfileSchema>;

// Better Auth requires a unique email, but OIDC identity is issuer + subject.
// Do not bind local users to an optional, mutable email claim from the provider.
const syntheticEmail = async (issuer: string, subject: string) => {
  const input = new TextEncoder().encode(`${issuer}\0${subject}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  const localPart = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${localPart}@oidc.invalid`;
};

const profileName = (profile: OidcProfile) => {
  if (profile.name) {
    return profile.name;
  }
  if (profile.preferred_username) {
    return profile.preferred_username;
  }
  return "Member";
};

export const createOidcProvider = (config: NonNullable<Config["oidc"]>) =>
  genericOAuth({
    config: [
      {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        discoveryUrl: config.discoveryUrl,
        mapProfileToUser: async (untrustedProfile) => {
          const profile = oidcProfileSchema.parse(untrustedProfile);
          return {
            email: await syntheticEmail(
              config.discoveryUrl,
              String(profile.sub)
            ),
            emailVerified: false,
            name: profileName(profile),
          };
        },
        name: config.providerName,
        providerId: "oidc",
        requireIdTokenVerification: true,
        scopes: ["email", "profile"],
      },
    ],
  });
