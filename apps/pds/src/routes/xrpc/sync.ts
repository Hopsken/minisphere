import * as GetLatestCommit from "@atcute/atproto/types/sync/getLatestCommit";
import * as GetRepo from "@atcute/atproto/types/sync/getRepo";
import * as GetRepoStatus from "@atcute/atproto/types/sync/getRepoStatus";
import * as SubscribeRepos from "@atcute/atproto/types/sync/subscribeRepos";
import { isDid, isNsid, isRecordKey } from "@atcute/lexicons/syntax";
import { Hono } from "hono";
import z from "zod";

import { createPdsDatabase } from "../../db";
import { lexiconQueryValidator } from "../../utils/lexicon-validator";
import { zValidator } from "../../utils/z-validator";

const app = new Hono<{
  Bindings: Env;
}>();

app.get(
  "/com.atproto.sync.getRepo",
  lexiconQueryValidator(GetRepo.mainSchema.params),
  () => {
    // Expected response: GetRepo.$output (application/vnd.ipld.car)
    throw new Error("Not implemented");
  }
);

app.get(
  "/com.atproto.sync.getLatestCommit",
  lexiconQueryValidator(GetLatestCommit.mainSchema.params),
  () => {
    // Expected response: GetLatestCommit.$output
    throw new Error("Not implemented");
  }
);

app.get(
  "/com.atproto.sync.getRepoStatus",
  lexiconQueryValidator(GetRepoStatus.mainSchema.params),
  async (c) => {
    const { did } = c.req.valid("query");
    const database = createPdsDatabase(c.env.PDS_DB);
    const account = await database.query.accountsTable.findFirst({
      columns: { did: true },
      where: { did },
    });
    if (!account) {
      return c.json({ active: false, did });
    }

    const repo = c.env.REPO.getByName(did);
    try {
      const repoStatus = await repo.rpcGetRepoStatus();
      return c.json({ active: true, did: repoStatus.did, rev: repoStatus.rev });
    } catch (error) {
      console.error("active PDS account has no readable repository", error);
      return c.json({ active: false, did, status: "desynchronized" });
    }
  }
);

app.get(
  "/com.atproto.sync.subscribeRepos",
  lexiconQueryValidator(SubscribeRepos.mainSchema.params),
  () => {
    // Expected subscription message: SubscribeRepos.$message
    throw new Error("Not implemented");
  }
);

app.get(
  "/com.atproto.sync.getRecord",
  zValidator(
    "query",
    z.object({
      collection: z
        .string({ error: "Missing required parameter: collection" })
        .refine(isNsid, { error: "Invalid collection format, must be NSID" }),
      did: z
        .string({ error: "Missing required parameter: did" })
        .refine(isDid, { error: "Invalid DID format" }),
      rkey: z
        .string({ error: "Missing required parameter: rkey" })
        .refine(isRecordKey, { error: "Invalid rkey format" }),
    })
  ),
  async (c) => {
    const { did, collection, rkey } = c.req.valid("query");
    const repo = c.env.REPO.getByName(did);
    const record = await repo.rpcGetRecord(collection, rkey);
    return c.json(record);
  }
);

export default app;
