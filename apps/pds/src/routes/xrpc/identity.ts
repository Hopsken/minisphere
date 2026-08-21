import * as ResolveHandle from "@atcute/atproto/types/identity/resolveHandle";
import {
  DidNotFoundError,
  WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { lexiconQueryValidator } from "../../utils/lexicon-validator";

const app = new Hono<{ Bindings: Env }>();

const handleResolver = new WellKnownHandleResolver();

app.get(
  "/com.atproto.identity.resolveHandle",
  lexiconQueryValidator(ResolveHandle.mainSchema.params),
  async (ctx) => {
    const { handle } = ctx.req.valid("query");

    try {
      const did = await handleResolver.resolve(handle);
      return ctx.json<ResolveHandle.$output>({ did });
    } catch (error) {
      if (error instanceof DidNotFoundError) {
        throw new HTTPException(400, {
          message: `Cant resolve handle ${handle}`,
        });
      }
      throw error;
    }
  }
);

export default app;
