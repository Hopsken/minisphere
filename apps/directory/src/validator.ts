import {
  extractMultikey,
  extractPrefixedBytes,
  parseDidKey,
} from "@atproto/crypto";
import { encode } from "@atproto/lex-cbor";
import type { Operation, OpOrTombstone } from "@did-plc/lib";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

const MAX_OPERATION_BYTES = 4000;
const MAX_ALSO_KNOWN_AS_ENTRIES = 10;
const MAX_ALSO_KNOWN_AS_LENGTH = 258;
const MAX_ROTATION_KEY_ENTRIES = 10;
const MAX_SERVICE_ENTRIES = 10;
const MAX_SERVICE_TYPE_LENGTH = 256;
const MAX_SERVICE_ENDPOINT_LENGTH = 512;
const MAX_VERIFICATION_METHOD_ENTRIES = 10;
const MAX_ID_LENGTH = 32;
const MAX_DID_KEY_LENGTH = 256;

const serviceSchema = z
  .object({
    endpoint: z.string(),
    type: z.string(),
  })
  .strict();

const operationSchema = z
  .object({
    alsoKnownAs: z.array(z.string()),
    prev: z.string().nullable(),
    rotationKeys: z.array(z.string()),
    services: z.record(z.string(), serviceSchema),
    sig: z.string(),
    type: z.literal("plc_operation"),
    verificationMethods: z.record(z.string(), z.string()),
  })
  .strict();

const tombstoneSchema = z
  .object({
    prev: z.string(),
    sig: z.string(),
    type: z.literal("plc_tombstone"),
  })
  .strict();

const incomingOperationSchema = z.discriminatedUnion("type", [
  operationSchema,
  tombstoneSchema,
]) satisfies z.ZodType<OpOrTombstone>;

const badRequest = (message: string): HTTPException =>
  new HTTPException(400, { message });

const describeValidationError = (error: z.ZodError): string => {
  const [issue] = error.issues;
  if (!issue) {
    return "unknown validation error";
  }

  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
};

const assertOperationSize = (operation: OpOrTombstone): void => {
  const { byteLength } = encode(operation);
  if (byteLength > MAX_OPERATION_BYTES) {
    throw badRequest(
      `Operation too large (${MAX_OPERATION_BYTES} bytes maximum in CBOR encoding)`
    );
  }
};

const assertValidSignatureEncoding = (operation: OpOrTombstone): void => {
  if (operation.sig.endsWith("=")) {
    throw badRequest("Invalid signature encoding");
  }
};

const assertValidAlsoKnownAs = ({ alsoKnownAs }: Operation): void => {
  if (alsoKnownAs.length > MAX_ALSO_KNOWN_AS_ENTRIES) {
    throw badRequest(
      `Too many alsoKnownAs entries (max ${MAX_ALSO_KNOWN_AS_ENTRIES})`
    );
  }

  const entries = new Set<string>();
  for (const entry of alsoKnownAs) {
    if (entry.length > MAX_ALSO_KNOWN_AS_LENGTH) {
      throw badRequest(
        `alsoKnownAs entry too long (max ${MAX_ALSO_KNOWN_AS_LENGTH}): ${entry}`
      );
    }
    if (entries.has(entry)) {
      throw badRequest(`Duplicate alsoKnownAs entry: ${entry}`);
    }
    entries.add(entry);
  }
};

const assertValidRotationKeys = ({ rotationKeys }: Operation): void => {
  if (rotationKeys.length > MAX_ROTATION_KEY_ENTRIES) {
    throw badRequest(
      `Too many rotation key entries (max ${MAX_ROTATION_KEY_ENTRIES})`
    );
  }

  for (const key of rotationKeys) {
    try {
      parseDidKey(key);
    } catch {
      throw badRequest(`Invalid rotation key: ${key}`);
    }
  }
};

const assertValidServices = ({ services }: Operation): void => {
  const entries = Object.entries(services);
  if (entries.length > MAX_SERVICE_ENTRIES) {
    throw badRequest(`Too many service entries (max ${MAX_SERVICE_ENTRIES})`);
  }

  for (const [id, service] of entries) {
    if (id.length > MAX_ID_LENGTH) {
      throw badRequest(`Service ID too long (max ${MAX_ID_LENGTH}): ${id}`);
    }
    if (service.type.length > MAX_SERVICE_TYPE_LENGTH) {
      throw badRequest(
        `Service type too long (max ${MAX_SERVICE_TYPE_LENGTH})`
      );
    }
    if (service.endpoint.length > MAX_SERVICE_ENDPOINT_LENGTH) {
      throw badRequest(
        `Service endpoint too long (max ${MAX_SERVICE_ENDPOINT_LENGTH})`
      );
    }
  }
};

const assertValidVerificationMethods = ({
  verificationMethods,
}: Operation): void => {
  const entries = Object.entries(verificationMethods);
  if (entries.length > MAX_VERIFICATION_METHOD_ENTRIES) {
    throw badRequest(
      `Too many verification method entries (max ${MAX_VERIFICATION_METHOD_ENTRIES})`
    );
  }

  for (const [id, key] of entries) {
    if (id.length > MAX_ID_LENGTH) {
      throw badRequest(
        `Verification method ID too long (max ${MAX_ID_LENGTH}): ${id}`
      );
    }
    if (key.length > MAX_DID_KEY_LENGTH) {
      throw badRequest(
        `Verification method key too long (max ${MAX_DID_KEY_LENGTH}): ${key}`
      );
    }

    try {
      const multikey = extractMultikey(key);
      extractPrefixedBytes(multikey);
    } catch {
      throw badRequest(`Invalid verification method key: ${key}`);
    }
  }
};

// This function is the runtime parser for the untrusted request body.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
export const validateIncomingOperation = (input: unknown): OpOrTombstone => {
  const result = incomingOperationSchema.safeParse(input);
  if (!result.success) {
    throw badRequest(
      `Not a valid operation: ${describeValidationError(result.error)}`
    );
  }

  const operation = result.data;
  assertOperationSize(operation);
  assertValidSignatureEncoding(operation);
  if (operation.type === "plc_tombstone") {
    return operation;
  }

  assertValidAlsoKnownAs(operation);
  assertValidRotationKeys(operation);
  assertValidServices(operation);
  assertValidVerificationMethods(operation);
  return operation;
};
