import * as CreateAccount from "@atcute/atproto/types/server/createAccount";
import * as CreateSession from "@atcute/atproto/types/server/createSession";
import * as DescribeServer from "@atcute/atproto/types/server/describeServer";
import * as GetSession from "@atcute/atproto/types/server/getSession";
import { Hono } from "hono";

import { lexiconJsonValidator } from "../../utils/lexicon-validator";

const app = new Hono<{ Bindings: Env }>();

app.post(
  "/com.atproto.server.createAccount",
  lexiconJsonValidator(CreateAccount.mainSchema.input.schema),
  () => {
    // Expected response: CreateAccount.$output
    throw new Error("Not implemented");
  }
);

app.post(
  "/com.atproto.server.createSession",
  lexiconJsonValidator(CreateSession.mainSchema.input.schema),
  () => {
    // Expected response: CreateSession.$output
    throw new Error("Not implemented");
  }
);

app.get("/com.atproto.server.getSession", () => {
  // Expected response: GetSession.$output
  throw new Error("Not implemented");
});

app.get("/com.atproto.server.describeServer", () => {
  // Expected response: DescribeServer.$output
  throw new Error("Not implemented");
});

export default app;
