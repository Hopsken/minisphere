import * as ApplyWrites from "@atcute/atproto/types/repo/applyWrites";
import * as CreateRecord from "@atcute/atproto/types/repo/createRecord";
import * as DeleteRecord from "@atcute/atproto/types/repo/deleteRecord";
import * as GetRecord from "@atcute/atproto/types/repo/getRecord";
import * as ListRecords from "@atcute/atproto/types/repo/listRecords";
import * as PutRecord from "@atcute/atproto/types/repo/putRecord";
import { Hono } from "hono";

import {
  lexiconJsonValidator,
  lexiconQueryValidator,
} from "../../utils/lexicon-validator";

const app = new Hono<{ Bindings: Env }>();

app.post(
  "/com.atproto.repo.createRecord",
  lexiconJsonValidator(CreateRecord.mainSchema.input.schema),
  () => {
    // Expected response: CreateRecord.$output
    throw new Error("Not implemented");
  }
);

app.post(
  "/com.atproto.repo.putRecord",
  lexiconJsonValidator(PutRecord.mainSchema.input.schema),
  () => {
    // Expected response: PutRecord.$output
    throw new Error("Not implemented");
  }
);

app.post(
  "/com.atproto.repo.deleteRecord",
  lexiconJsonValidator(DeleteRecord.mainSchema.input.schema),
  () => {
    // Expected response: DeleteRecord.$output
    throw new Error("Not implemented");
  }
);

app.post(
  "/com.atproto.repo.applyWrites",
  lexiconJsonValidator(ApplyWrites.mainSchema.input.schema),
  () => {
    // Expected response: ApplyWrites.$output
    throw new Error("Not implemented");
  }
);

app.get(
  "/com.atproto.repo.getRecord",
  lexiconQueryValidator(GetRecord.mainSchema.params),
  () => {
    // Expected response: GetRecord.$output
    throw new Error("Not implemented");
  }
);

app.get(
  "/com.atproto.repo.listRecords",
  lexiconQueryValidator(ListRecords.mainSchema.params),
  () => {
    // Expected response: ListRecords.$output
    throw new Error("Not implemented");
  }
);

export default app;
