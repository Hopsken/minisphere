import * as CreateAccount from "@atcute/atproto/types/server/createAccount";
import * as CreateSession from "@atcute/atproto/types/server/createSession";
import {
  parseDidKey,
  parsePrivateMultikey,
  Secp256k1PrivateKey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import {
  deriveDidFromGenesisOp,
  PlcClient,
  signOperation,
} from "@atcute/did-plc";
import type { DidKeyString, UnsignedOperation } from "@atcute/did-plc";
import { isHandle } from "@atcute/lexicons/syntax";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import z from "zod";

import { verifyInviteCode } from "../../auth/invite-code";
import { hashPassword } from "../../auth/password";
import { createSessionTokens } from "../../auth/session";
import { createPdsDatabase } from "../../db";
import { accountsTable, refreshTokensTable } from "../../db/schema";
import { lexiconJsonValidator } from "../../utils/lexicon-validator";
import { zValidator } from "../../utils/z-validator";

const app = new Hono<{ Bindings: Env }>();

const PASSWORD_MIN_LENGTH = 16;
const PASSWORD_MAX_LENGTH = 256;

const recoveryKeySchema = z
  .string()
  .refine(
    (value) => {
      try {
        parseDidKey(value);
        return true;
      } catch {
        return false;
      }
    },
    { error: "Invalid DID PLC recovery key" }
  )
  .transform(
    (value): DidKeyString => `did:key:${value.slice("did:key:".length)}`
  );

const handleSchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .refine(isHandle, { error: "Invalid handle" })
  .refine(
    (value) => {
      const accountNameLength = value.split(".", 1)[0]?.length ?? 0;
      return accountNameLength >= 2 && accountNameLength <= 63;
    },
    { error: "Account name must contain 2-63 characters" }
  );

const createAccountSchema = z.strictObject({
  handle: handleSchema,
  inviteCode: z.string().min(1),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  recoveryKey: recoveryKeySchema,
});

app.post(
  "/com.atproto.server.createAccount",
  lexiconJsonValidator(CreateAccount.mainSchema.input.schema),
  zValidator("json", createAccountSchema),
  async (c) => {
    const { handle, inviteCode, password, recoveryKey } = c.req.valid("json");
    const pdsHostname = c.env.PDS_HOSTNAME.toLowerCase();
    const pdsOrigin = `https://${pdsHostname}`;

    if (
      !(await verifyInviteCode(
        inviteCode,
        pdsOrigin,
        c.env.CONTROL_PLANE_PUBLIC_KEY
      ))
    ) {
      throw new HTTPException(400, { message: "Invalid invite code" });
    }

    const [, ...handleDomainParts] = handle.split(".");
    if (handleDomainParts.join(".") !== pdsHostname) {
      throw new HTTPException(400, {
        message: `Handle must be a single account name under ${pdsHostname}`,
      });
    }

    const pdsDb = createPdsDatabase(c.env.PDS_DB);
    const existingAccount = await pdsDb.query.accountsTable.findFirst({
      where: { handle },
    });
    if (existingAccount) {
      throw new HTTPException(400, { message: "Handle is not available" });
    }

    const parsedRotationKey = parsePrivateMultikey(c.env.PDS_ROTATION_KEY);
    if (parsedRotationKey.type !== "secp256k1") {
      throw new Error("PDS_ROTATION_KEY must be a secp256k1 private multikey");
    }

    const rotationKey = await Secp256k1PrivateKey.importRaw(
      parsedRotationKey.privateKeyBytes
    );
    const pdsRotationKey = await rotationKey.exportPublicKey("did");
    const rotationKeys =
      recoveryKey === pdsRotationKey
        ? [pdsRotationKey]
        : [recoveryKey, pdsRotationKey];

    const repoKey = await Secp256k1PrivateKeyExportable.createKeypair();
    const repoSigningKey = await repoKey.exportPublicKey("did");
    const unsignedOperation: UnsignedOperation = {
      alsoKnownAs: [`at://${handle}`],
      prev: null,
      rotationKeys,
      services: {
        atproto_pds: {
          endpoint: pdsOrigin,
          type: "AtprotoPersonalDataServer",
        },
      },
      type: "plc_operation",
      verificationMethods: { atproto: repoSigningKey },
    };
    const operation = await signOperation(unsignedOperation, rotationKey);
    const did = await deriveDidFromGenesisOp(operation);

    const [passwordHash, session, repoSigningKeyMultikey] = await Promise.all([
      hashPassword(password),
      createSessionTokens(did, `did:web:${pdsHostname}`, c.env.PDS_JWT_SECRET),
      repoKey.exportPrivateKey("multikey"),
    ]);

    const repo = c.env.REPO.getByName(did);
    await repo.reserveRepo(did, repoSigningKeyMultikey);

    const directory = new PlcClient({
      fetch: (request, init) =>
        c.env.DIRECTORY.fetch(new Request(request, init)),
      serviceUrl: "https://minisphere-directory",
    });
    await directory.submitOperation(did, operation);

    await pdsDb.batch([
      pdsDb.insert(accountsTable).values({
        did,
        handle,
        password_hash: passwordHash,
      }),
      pdsDb.insert(refreshTokensTable).values({
        did,
        expires_at: session.refreshToken.expiresAt,
        jti: session.refreshToken.jti,
      }),
    ]);

    return c.json({
      accessJwt: session.accessJwt,
      did,
      handle,
      refreshJwt: session.refreshJwt,
    });
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
