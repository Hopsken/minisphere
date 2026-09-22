import { PlcClient } from "@atcute/did-plc";
import type { DidPlcString } from "@atcute/did-plc";

export class PlcDirectoryClient {
  private readonly client: PlcClient;

  constructor(origin: string) {
    this.client = new PlcClient({ serviceUrl: new URL(origin).href });
  }

  getState(did: DidPlcString) {
    return this.client.getState(did);
  }
}
