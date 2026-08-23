import { Client, simpleFetchHandler } from "@atcute/client";

export const createPdsClient = (env: Env) =>
  new Client({
    handler: simpleFetchHandler({
      fetch: (request, init) => env.PDS.fetch(request, init),
      service: "https://minisphere-pds.service",
    }),
  });

export type PdsClient = Client;
