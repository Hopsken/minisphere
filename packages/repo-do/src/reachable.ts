import { MSTNode } from "@atcute/mst";

import type { CoreStorage } from "./core/storage";

/**
 * Return the `cids` that the repository at `root` reaches. Reads every MST
 * node but no record, because each node already names its records.
 */
export const findReachable = async (
  storage: CoreStorage,
  root: { commit: string; data: string },
  cids: ReadonlySet<string>
): Promise<Set<string>> => {
  const reachable = new Set<string>();
  const visit = (cid: string) => {
    if (cids.has(cid)) {
      reachable.add(cid);
    }
  };
  visit(root.commit);
  const pending = [root.data];
  while (pending.length > 0) {
    const batch = pending.splice(-90);
    const found = storage.getStoredBlocks(batch);
    // oxlint-disable-next-line no-await-in-loop -- Each batch comes from the nodes decoded before it.
    const nodes = await Promise.all(
      batch.map((cid) => {
        const block = found.get(cid);
        if (!block) {
          throw new Error(`Repository block is missing: ${cid}`);
        }
        visit(cid);
        return MSTNode.deserialize(block.bytes);
      })
    );
    for (const { subtrees, values } of nodes) {
      for (const value of values) {
        visit(value.$link);
      }
      for (const subtree of subtrees) {
        if (subtree) {
          pending.push(subtree.$link);
        }
      }
    }
  }
  return reachable;
};
