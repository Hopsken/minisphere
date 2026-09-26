import * as GetLatestCommit from "@atcute/atproto/types/sync/getLatestCommit";
import * as GetRecord from "@atcute/atproto/types/sync/getRecord";
import * as GetRepo from "@atcute/atproto/types/sync/getRepo";
import * as GetRepoStatus from "@atcute/atproto/types/sync/getRepoStatus";
import * as SubscribeRepos from "@atcute/atproto/types/sync/subscribeRepos";
import { SEQUENCER_NAME } from "@minisphere/pds-sequencer-do";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { createPdsDatabase } from "../../db";
import { withRepoReader } from "../../middlewares/with-repo-reader";
import { lexiconQueryValidator } from "../../utils/lexicon-validator";

const app = new Hono<{
  Bindings: Env;
}>()
  .get(
    "/com.atproto.sync.getRepo",
    lexiconQueryValidator(GetRepo.mainSchema.params),
    withRepoReader,
    async (c) => {
      const { did, since } = c.req.valid("query");
      const car = await c.var.repoReader.exportRepo(did, since);
      return new Response(car, {
        headers: { "Content-Type": "application/vnd.ipld.car" },
      });
    }
  )
  .get(
    "/com.atproto.sync.getLatestCommit",
    lexiconQueryValidator(GetLatestCommit.mainSchema.params),
    withRepoReader,
    async (c) => {
      const { did } = c.req.valid("query");
      return c.json<GetLatestCommit.$output>(
        await c.var.repoReader.getLatestCommit(did)
      );
    }
  )
  .get(
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
        return c.json({
          active: true,
          did: repoStatus.did,
          rev: repoStatus.rev,
        });
      } catch (error) {
        console.error("active PDS account has no readable repository", error);
        return c.json({ active: false, did, status: "desynchronized" });
      }
    }
  )
  .get(
    "/com.atproto.sync.subscribeRepos",
    lexiconQueryValidator(SubscribeRepos.mainSchema.params),
    (c) => {
      if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
        throw new HTTPException(426, {
          message: "subscribeRepos requires a WebSocket upgrade",
        });
      }
      return c.env.SEQUENCER.getByName(SEQUENCER_NAME).fetch(c.req.raw);
    }
  )
  .get(
    "/com.atproto.sync.getRecord",
    lexiconQueryValidator(GetRecord.mainSchema.params),
    withRepoReader,
    async (c) => {
      const { did, collection, rkey } = c.req.valid("query");
      const proof = await c.var.repoReader.getRecordProof(
        did,
        collection,
        rkey
      );
      return new Response(proof, {
        headers: { "Content-Type": "application/vnd.ipld.car" },
      });
    }
  );

export default app;
