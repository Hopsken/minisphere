import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { z } from "zod";

const oidcProfileSchema = z.looseObject({
  name: z.string().trim().optional(),
  preferred_username: z.string().trim().optional(),
  sub: z.union([z.string(), z.number()]),
});

type OidcProfile = z.infer<typeof oidcProfileSchema>;

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

export const createOidcProvider = (env: Env) =>
  genericOAuth({
    config: [
      {
        clientId: env.OIDC_CLIENT_ID,
        clientSecret: env.OIDC_CLIENT_SECRET,
        discoveryUrl: env.OIDC_DISCOVERY_URL,
        mapProfileToUser: async (untrustedProfile) => {
          const profile = oidcProfileSchema.parse(untrustedProfile);
          return {
            email: await syntheticEmail(
              env.OIDC_DISCOVERY_URL,
              String(profile.sub)
            ),
            emailVerified: false,
            name: profileName(profile),
          };
        },
        name: env.OIDC_PROVIDER_NAME,
        providerId: "oidc",
        requireIdTokenVerification: true,
        scopes: ["email", "profile"],
      },
    ],
  });
