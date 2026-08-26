import { PlcClient } from "@atcute/did-plc";

export const createPlcClient = (env: Env) =>
  new PlcClient({
    fetch: (request, init) => env.PlcDirectory.fetch(request, init),
    serviceUrl: "https://minisphere-directory.service",
  });
