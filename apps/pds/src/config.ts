import { env } from "cloudflare:workers";
import { z } from "zod";

const originSchema = z.url({ protocol: /^https?$/u }).pipe(
  z.string().refine((value) => new URL(value).origin === value, {
    error:
      "Expected a canonical HTTP(S) origin without credentials, path, query, or fragment",
  })
);

const configSchema = z.object({
  MINISPHERE_ORIGIN: originSchema,
  PDS_ORIGIN: originSchema.optional(),
  PLC_DIRECTORY: originSchema.default("https://plc.directory"),
});

export const resolveConfig = () => {
  const config = configSchema.parse(env);
  const accounts = new URL(config.MINISPHERE_ORIGIN);
  const pds = new URL(accounts.origin);
  pds.hostname = `pds.${accounts.hostname}`;
  return {
    accountsOrigin: accounts.origin,
    pdsOrigin: config.PDS_ORIGIN ?? pds.origin,
    plcDirectory: config.PLC_DIRECTORY,
  };
};
