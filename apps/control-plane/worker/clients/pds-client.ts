import { Client, simpleFetchHandler } from "@atcute/client";

export const createPdsClient = (env: Env) =>
  new Client({
    handler: simpleFetchHandler({
      fetch: env.PDS.fetch,
      service: "https://minisphere-pds.service",
    }),
  });

export type PdsClient = Client;
