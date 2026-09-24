import * as ApplyWrites from "@atcute/atproto/types/repo/applyWrites";
import * as CreateRecord from "@atcute/atproto/types/repo/createRecord";
import * as DeleteRecord from "@atcute/atproto/types/repo/deleteRecord";
import * as DescribeRepo from "@atcute/atproto/types/repo/describeRepo";
import * as GetRecord from "@atcute/atproto/types/repo/getRecord";
import * as ListRecords from "@atcute/atproto/types/repo/listRecords";
import * as PutRecord from "@atcute/atproto/types/repo/putRecord";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { withRepoReader } from "../../middlewares/with-repo-reader";
import { withRepoWriter } from "../../middlewares/with-repo-writer";
import { withResourceAuth } from "../../middlewares/with-resource-auth";
import {
  lexiconJsonValidator,
  lexiconQueryValidator,
} from "../../utils/lexicon-validator";
import { xrpcError } from "../../utils/xrpc-error";

const writeBodyLimit = bodyLimit({
  maxSize: 1_000_000,
  onError: () => {
    throw xrpcError("InvalidRequest", "Write request is too large");
  },
});

const app = new Hono<{ Bindings: Env }>()
  .post(
    "/com.atproto.repo.createRecord",
    writeBodyLimit,
    lexiconJsonValidator(CreateRecord.mainSchema.input.schema),
    withResourceAuth,
    withRepoWriter,
    async (c) => c.json(await c.var.repoWriter.create(c.req.valid("json")))
  )
  .post(
    "/com.atproto.repo.putRecord",
    writeBodyLimit,
    lexiconJsonValidator(PutRecord.mainSchema.input.schema),
    withResourceAuth,
    withRepoWriter,
    async (c) => c.json(await c.var.repoWriter.put(c.req.valid("json")))
  )
  .post(
    "/com.atproto.repo.deleteRecord",
    writeBodyLimit,
    lexiconJsonValidator(DeleteRecord.mainSchema.input.schema),
    withResourceAuth,
    withRepoWriter,
    async (c) => c.json(await c.var.repoWriter.delete(c.req.valid("json")))
  )
  .post(
    "/com.atproto.repo.applyWrites",
    writeBodyLimit,
    lexiconJsonValidator(ApplyWrites.mainSchema.input.schema),
    withResourceAuth,
    withRepoWriter,
    async (c) => c.json(await c.var.repoWriter.apply(c.req.valid("json")))
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
