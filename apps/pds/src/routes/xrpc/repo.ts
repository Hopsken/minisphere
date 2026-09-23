import * as ApplyWrites from "@atcute/atproto/types/repo/applyWrites";
import * as CreateRecord from "@atcute/atproto/types/repo/createRecord";
import * as DeleteRecord from "@atcute/atproto/types/repo/deleteRecord";
import * as DescribeRepo from "@atcute/atproto/types/repo/describeRepo";
import * as GetRecord from "@atcute/atproto/types/repo/getRecord";
import * as ListRecords from "@atcute/atproto/types/repo/listRecords";
import * as PutRecord from "@atcute/atproto/types/repo/putRecord";
import { Hono } from "hono";

import { withRepoReader } from "../../middlewares/with-repo-reader";
import {
  lexiconJsonValidator,
  lexiconQueryValidator,
} from "../../utils/lexicon-validator";

const app = new Hono<{ Bindings: Env }>()
  .post(
    "/com.atproto.repo.createRecord",
    lexiconJsonValidator(CreateRecord.mainSchema.input.schema),
    () => {
      // Expected response: CreateRecord.$output
      throw new Error("Not implemented");
    }
  )
  .post(
    "/com.atproto.repo.putRecord",
    lexiconJsonValidator(PutRecord.mainSchema.input.schema),
    () => {
      // Expected response: PutRecord.$output
      throw new Error("Not implemented");
    }
  )
  .post(
    "/com.atproto.repo.deleteRecord",
    lexiconJsonValidator(DeleteRecord.mainSchema.input.schema),
    () => {
      // Expected response: DeleteRecord.$output
      throw new Error("Not implemented");
    }
  )
  .post(
    "/com.atproto.repo.applyWrites",
    lexiconJsonValidator(ApplyWrites.mainSchema.input.schema),
    () => {
      // Expected response: ApplyWrites.$output
      throw new Error("Not implemented");
    }
  )
  .get(
    "/com.atproto.repo.getRecord",
    lexiconQueryValidator(GetRecord.mainSchema.params),
    withRepoReader,
    async (c) => {
      const record = await c.var.repoReader.getRecord(c.req.valid("query"));
      return c.json(record);
    }
  )
  .get(
    "/com.atproto.repo.listRecords",
    lexiconQueryValidator(ListRecords.mainSchema.params),
    withRepoReader,
    async (c) => {
      const page = await c.var.repoReader.listRecords(c.req.valid("query"));
      return c.json(page);
    }
  )
  .get(
    "/com.atproto.repo.describeRepo",
    lexiconQueryValidator(DescribeRepo.mainSchema.params),
    withRepoReader,
    async (c) => {
      const { repo } = c.req.valid("query");
      return c.json(await c.var.repoReader.describe(repo));
    }
  );

export default app;
