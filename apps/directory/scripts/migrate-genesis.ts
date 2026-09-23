import { parseArgs } from "node:util";

import { cidForLex } from "@atproto/lex-cbor";
import * as plc from "@did-plc/lib";
import { z } from "zod";

const auditSchema = z.array(
  z.object({
    cid: z.string(),
    did: z.string(),
    nullified: z.boolean(),
    operation: z.unknown(),
  })
);

const directoryOrigin = (value: string) => {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Directory must be an HTTP(S) origin without credentials");
  }
  return url.origin;
};

const request = (url: string, init?: RequestInit) =>
  fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });

const readGenesis = async (
  origin: string,
  did: string,
  allowMissing: boolean
) => {
  const response = await request(
    `${origin}/${encodeURIComponent(did)}/log/audit`
  );
  if (allowMissing && response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Cannot read ${origin} audit log: HTTP ${response.status}`);
  }
  const entries = auditSchema.parse(await response.json());
  const [entry] = entries;
  if (entries.length !== 1 || !entry || entry.nullified || entry.did !== did) {
    throw new Error(`${origin}: expected exactly one non-nullified genesis`);
  }
  const operation = plc.def.operation.parse(entry.operation);
  if (operation.prev !== null) {
    throw new Error(`${origin}: operation is not genesis`);
  }
  await plc.assureValidNextOp(did, [], operation);
  const operationCid = await cidForLex(operation);
  const cid = operationCid.toString();
  if (entry.cid !== cid) {
    throw new Error(`${origin}: audit CID does not match the operation`);
  }
  return { cid, operation };
};

export const migrateGenesis = async ({
  source,
  target,
  did,
  apply = false,
}: {
  source: string;
  target: string;
  did: string;
  apply?: boolean;
}) => {
  const from = directoryOrigin(source);
  const to = directoryOrigin(target);
  if (from === to || !/^did:plc:[a-z2-7]{24}$/u.test(did)) {
    throw new Error("Use different directories and a valid did:plc identifier");
  }
  const genesis = await readGenesis(from, did, false);
  if (!genesis) {
    throw new Error("Source genesis is missing");
  }
  const existing = await readGenesis(to, did, true);
  if (existing && existing.cid !== genesis.cid) {
    throw new Error(
      "Target contains a different operation; nothing was written"
    );
  }
  if (existing || !apply) {
    return {
      ...genesis,
      status: existing ? "already-present" : "ready (dry run; no writes)",
    };
  }

  // The source must stay unchanged during migration; check again before writing.
  const current = await readGenesis(from, did, false);
  if (current?.cid !== genesis.cid) {
    throw new Error("Source changed; nothing was written");
  }
  const response = await request(`${to}/${encodeURIComponent(did)}`, {
    body: JSON.stringify(genesis.operation),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Submission returned HTTP ${response.status}; rerun to check`
    );
  }
  const published = await readGenesis(to, did, true);
  if (published?.cid !== genesis.cid) {
    throw new Error(
      "Target verification failed; rerun to check before retrying"
    );
  }
  return { ...genesis, status: "migrated" };
};

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        apply: { default: false, type: "boolean" },
        did: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
      },
    });
    if (!(values.from && values.to && values.did)) {
      throw new Error(
        "Usage: pnpm --filter @minisphere/directory migrate:genesis --from URL --to URL --did DID [--apply]"
      );
    }
    console.log(`PLC genesis: ${values.did}\n${values.from} → ${values.to}`);
    const result = await migrateGenesis({
      apply: values.apply,
      did: values.did,
      source: values.from,
      target: values.to,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  }
}
