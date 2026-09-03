import { PlcClient, PlcClientError } from "@atcute/did-plc";
import type { DidPlcString } from "@atcute/did-plc";
import {
  CompositeHandleResolver,
  DidNotFoundError,
  DohJsonHandleResolver,
  HandleResolutionError,
  WellKnownHandleResolver,
  XrpcHandleResolver,
} from "@atcute/identity-resolver";
import type { HandleResolver } from "@atcute/identity-resolver";
import { isHandle } from "@atcute/lexicons/syntax";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

const scope = "atproto";
type TownEnv = Omit<Env, "DEV_HANDLE_RESOLVER_ORIGIN"> & {
  DEV_HANDLE_RESOLVER_ORIGIN?: string;
};

const getOAuthConfiguration = (env: TownEnv) => {
  const publicOrigin = new URL(env.PUBLIC_URL).origin;
  return {
    clientId: `${publicOrigin}/oauth-client-metadata.json`,
    redirectUri: `${publicOrigin}/oauth/callback`,
    scope,
  };
};

const didPlcPattern = /^did:plc:[a-z2-7]{24}$/u;

const parseDid = (value: string): DidPlcString => {
  if (!didPlcPattern.test(value)) {
    throw new HTTPException(400, { message: "Invalid did:plc identifier" });
  }
  return `did:plc:${value.slice("did:plc:".length)}`;
};

const createPlcClient = (directoryOrigin: string) =>
  new PlcClient({
    serviceUrl: new URL(directoryOrigin).origin,
  });

const publicHandleResolver = new CompositeHandleResolver({
  methods: {
    dns: new DohJsonHandleResolver({
      dohUrl: "https://cloudflare-dns.com/dns-query",
    }),
    http: new WellKnownHandleResolver(),
  },
});

const api = new Hono<{ Bindings: TownEnv }>()
  .get("/configuration", (context) =>
    context.json(getOAuthConfiguration(context.env))
  )
  .get("/did-documents/:did", async (context) => {
    const did = parseDid(context.req.param("did"));
    try {
      const document = await createPlcClient(
        context.env.PLC_DIRECTORY_ORIGIN
      ).getDocument(did);
      return context.json(document, 200, {
        "Content-Type": "application/did+ld+json",
      });
    } catch (error) {
      if (error instanceof PlcClientError && error.status === 404) {
        throw new HTTPException(404, { message: "DID not found" });
      }
      throw error;
    }
  })
  .get("/identities/:did", async (context) => {
    const did = parseDid(context.req.param("did"));
    let state;
    try {
      state = await createPlcClient(context.env.PLC_DIRECTORY_ORIGIN).getState(
        did
      );
    } catch (error) {
      if (error instanceof PlcClientError && error.status === 404) {
        throw new HTTPException(404, { message: "DID not found" });
      }
      throw error;
    }

    const handle = state.alsoKnownAs
      .find((identifier) => identifier.startsWith("at://"))
      ?.slice("at://".length);
    if (!handle || !isHandle(handle)) {
      throw new HTTPException(502, {
        message: "DID does not contain a valid handle",
      });
    }

    return context.json({ did, handle });
  });

const app = new Hono<{ Bindings: TownEnv }>()
  .use(logger())
  .get("/oauth-client-metadata.json", (context) => {
    const configuration = getOAuthConfiguration(context.env);
    context.header("Cache-Control", "public, max-age=300");
    return context.json({
      application_type: "web",
      client_id: configuration.clientId,
      client_name: "Town",
      client_uri: new URL(context.env.PUBLIC_URL).origin,
      dpop_bound_access_tokens: true,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [configuration.redirectUri],
      response_types: ["code"],
      scope,
      token_endpoint_auth_method: "none",
    });
  })
  .get("/xrpc/com.atproto.identity.resolveHandle", async (context) => {
    const handle = context.req.query("handle")?.toLowerCase();
    if (!handle || !isHandle(handle)) {
      return context.json(
        { error: "InvalidRequest", message: "A valid handle is required" },
        400
      );
    }

    let resolver: HandleResolver = publicHandleResolver;
    if (handle.endsWith(".test")) {
      const resolverOrigin = context.env.DEV_HANDLE_RESOLVER_ORIGIN;
      if (!resolverOrigin) {
        throw new HTTPException(503, {
          message: "Local .test handle resolution is not configured",
        });
      }
      resolver = new XrpcHandleResolver({
        serviceUrl: new URL(resolverOrigin).origin,
      });
    }

    try {
      return context.json({ did: await resolver.resolve(handle) });
    } catch (error) {
      if (error instanceof DidNotFoundError) {
        return context.json(
          { error: "HandleNotFound", message: "Handle not found" },
          400
        );
      }
      if (error instanceof HandleResolutionError) {
        return context.json(
          { error: "HandleResolutionFailed", message: error.message },
          502
        );
      }
      throw error;
    }
  })
  .route("/api", api)
  .notFound((context) =>
    context.json({ error: "NotFound", message: "API endpoint not found" }, 404)
  )
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  .onError((error, context) => {
    console.error(error);
    if (error instanceof HTTPException) {
      return context.json({ message: error.message }, error.status);
    }
    return context.json({ message: "Internal server error" }, 500);
  });

export default app;
export type ApiType = typeof api;
