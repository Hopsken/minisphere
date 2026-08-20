import { isDid, isNsid, isRecordKey } from "@atcute/lexicons/syntax";
import { Hono } from "hono";
import z from "zod";

import { zValidator } from "../../utils/z-validator";

const app = new Hono<{
  Bindings: Env;
}>();

const didSchema = z.object({
  did: z
    .string({ error: "Missing required parameter: did" })
    .refine(isDid, { error: "Invalid DID format" }),
});

app.get("/_health", (c) => c.json({ ok: true }));

app.get(
  "/com.atproto.sync.getRepoStatus",
  zValidator("query", didSchema),
  async (c) => {
    const { did } = c.req.valid("query");
    const pds = c.env.PDS.getByName(did);
    const repoStatus = await pds.rpcGetRepoStatus();
    return c.json(repoStatus);
  }
);

app.get(
  "/com.atproto.sync.getRecord",
  zValidator(
    "query",
    didSchema.extend({
      collection: z
        .string({ error: "Missing required parameter: collection" })
        .refine(isNsid, { error: "Invalid collection format, must be NSID" }),
      rkey: z
        .string({ error: "Missing required parameter: rkey" })
        .refine(isRecordKey, { error: "Invalid rkey format" }),
    })
  ),
  async (c) => {
    const { did, collection, rkey } = c.req.valid("query");
    const pds = c.env.PDS.getByName(did);
    const record = await pds.rpcGetRecord(collection, rkey);
    return c.json(record);
  }
);

export default app;
