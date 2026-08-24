import { Client, simpleFetchHandler } from "@atcute/client";

export const createPdsClient = (env: Env) =>
  new Client({
    handler: simpleFetchHandler({
      fetch: (request, init) => env.PDS.fetch(request, init),
      service: env.PDS_ORIGIN,
    }),
  });

export type PdsClient = Client;
