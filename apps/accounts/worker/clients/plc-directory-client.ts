import {
  normalizeOp,
  PlcClient,
  processIndexedEntryLog,
} from "@atcute/did-plc";
import type { DidPlcString, Operation } from "@atcute/did-plc";

const REQUEST_TIMEOUT_MS = 10_000;

export class PlcDirectoryClient {
  private readonly client: PlcClient;

  constructor(origin: string) {
    this.client = new PlcClient({
      // Bound every directory request, and keep any caller-provided signal.
      fetch: (input, init) => {
        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        return fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, timeout])
            : timeout,
        });
      },
      serviceUrl: new URL(origin).href,
    });
  }

  getState(did: DidPlcString) {
    return this.client.getState(did);
  }

  getDocument(did: DidPlcString) {
    return this.client.getDocument(did);
  }

  async getHead(did: DidPlcString) {
    const audit = await this.client.getAuditLog(did);
    const { canonical } = await processIndexedEntryLog(did, audit);
    const head = canonical.at(-1);
    if (!head || head.nullified || head.operation.type === "plc_tombstone") {
      throw new Error("PLC identity has no active head");
    }
    return { cid: head.cid, operation: normalizeOp(head.operation) };
  }

  submitOperation(did: DidPlcString, operation: Operation) {
    return this.client.submitOperation(did, operation);
  }
}
