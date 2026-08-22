import { PlcClient } from "@atcute/did-plc";

export const createPlcClient = (env: Env) =>
  new PlcClient({
    fetch: env.PlcDirectory.fetch,
    serviceUrl: "https://minisphere-directory.service",
  });
