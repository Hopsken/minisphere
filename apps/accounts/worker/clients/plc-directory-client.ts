import { PlcClient } from "@atcute/did-plc";
import type { DidPlcString } from "@atcute/did-plc";

export class PlcDirectoryClient {
  private readonly client: PlcClient;

  constructor(directory: Fetcher) {
    this.client = new PlcClient({
      fetch: (request, init) => directory.fetch(new Request(request, init)),
      serviceUrl: "https://minisphere-directory.service",
    });
  }

  getState(did: DidPlcString) {
    return this.client.getState(did);
  }
}
