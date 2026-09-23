import {
  normalizeOp,
  PlcClient,
  processIndexedEntryLog,
} from "@atcute/did-plc";
import type { DidPlcString, Operation } from "@atcute/did-plc";

export class PlcDirectoryClient {
  private readonly client: PlcClient;

  constructor(origin: string) {
    this.client = new PlcClient({ serviceUrl: new URL(origin).href });
  }

  getState(did: DidPlcString) {
    return this.client.getState(did);
  }

  async getHead(did: DidPlcString) {
    const audit = await this.client.getAuditLog(did, {
      signal: AbortSignal.timeout(10_000),
    });
    const { canonical } = await processIndexedEntryLog(did, audit);
    const head = canonical.at(-1);
    if (!head || head.nullified || head.operation.type === "plc_tombstone") {
      throw new Error("PLC identity has no active head");
    }
    return { cid: head.cid, operation: normalizeOp(head.operation) };
  }

  submitOperation(did: DidPlcString, operation: Operation) {
    return this.client.submitOperation(did, operation, {
      signal: AbortSignal.timeout(10_000),
    });
  }
}
