import { writeCarStream } from "@atcute/car";
import type { CarBlock } from "@atcute/car";
import { fromString, toCidLink } from "@atcute/cid";
import { MSTNode } from "@atcute/mst";

import type { CoreStorage, StoredBlock } from "./core/storage";

interface RepoBlock extends StoredBlock {
  cid: string;
}

const toCarBlock = (block: RepoBlock): CarBlock => ({
  cid: fromString(block.cid).bytes,
  data: block.bytes,
});

/**
 * Stream a repository as a CAR in the Sync 1.1 preorder: the commit, then each
 * MST node followed by its entries in order, descending into subtrees
 * depth-first. Only the current path of nodes is held in memory.
 *
 * With `since`, only blocks written after that revision are included. Every
 * commit rewrites each block that becomes reachable with its revision, so a
 * reachable block with an older revision has stayed reachable since then. A
 * consumer at `since` already holds it and, for a node, its whole subtree.
 */
export const exportRepoCar = (
  storage: CoreStorage,
  root: { commit: string; data: string },
  since: string | undefined
) => {
  const isNew = (block: StoredBlock) =>
    since === undefined || block.rev > since;

  const read = (cids: readonly string[]): RepoBlock[] => {
    const found = storage.getStoredBlocks(cids);
    return cids.map((cid) => {
      const block = found.get(cid);
      if (!block) {
        throw new Error(`Repository block is missing: ${cid}`);
      }
      return { cid, ...block };
    });
  };

  const walkNode = async function* walkNode(
    cid: string
  ): AsyncGenerator<CarBlock> {
    const [node] = read([cid]);
    if (!node || !isNew(node)) {
      return;
    }
    yield toCarBlock(node);
    const { subtrees, values } = await MSTNode.deserialize(node.bytes);
    const records = read(values.map((value) => value.$link));
    // A node holds `subtrees[0]`, then each record followed by the subtree to its right.
    for (const [index, subtree] of subtrees.entries()) {
      if (subtree) {
        yield* walkNode(subtree.$link);
      }
      const record = records[index];
      if (record && isNew(record)) {
        yield toCarBlock(record);
      }
    }
  };

  const walkRepo = async function* walkRepo(): AsyncGenerator<CarBlock> {
    const [commit] = read([root.commit]);
    if (commit && isNew(commit)) {
      yield toCarBlock(commit);
    }
    yield* walkNode(root.data);
  };

  return writeCarStream([toCidLink(fromString(root.commit))], walkRepo());
};
