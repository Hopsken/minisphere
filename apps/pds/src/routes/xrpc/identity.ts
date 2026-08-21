import * as ResolveHandle from "@atcute/atproto/types/identity/resolveHandle";
import { Hono } from "hono";

import { lexiconQueryValidator } from "../../utils/lexicon-validator";

const app = new Hono<{ Bindings: Env }>();

app.get(
  "/com.atproto.identity.resolveHandle",
  lexiconQueryValidator(ResolveHandle.mainSchema.params),
  () => {
    // Expected response: ResolveHandle.$output
    throw new Error("Not implemented");
  }
);

export default app;
