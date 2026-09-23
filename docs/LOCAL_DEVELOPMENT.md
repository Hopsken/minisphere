# Local Development Environment

Minisphere's local AT Protocol group consists of Accounts, PDS, and the PLC Directory. Town is an external OAuth client. Accounts now publishes handles directly; there is no Handle Registry service or `AccountsEntrypoint`.

## Topology

| Component | Local origin | Role |
| --- | --- | --- |
| PDS | `http://localhost:8787` | resource server and repository host |
| PLC Directory | `http://localhost:8788` | `did:plc` authority |
| Accounts | `http://localhost:8790` | entryway, authorization server, and handle resolver |
| Town | `http://127.0.0.1:5174` | independent OAuth client |

Ports are unchanged except that former registry port 8789 is unused. Accounts retains its PDS service binding; Accounts and PDS access the configured PLC Directory over HTTP.

## Configuration

Accounts and PDS each validate configuration with their own Zod schema. Set the same required `MINISPHERE_ORIGIN` in both services to derive the Accounts and `pds.<hostname>` origins. Only Accounts configures the hosted-handle suffix. Local templates override the PDS origin and Accounts handle suffix because the services use separate loopback ports and `.test` handles:

| Owner    | Value                                              |
| -------- | -------------------------------------------------- |
| Accounts | `MINISPHERE_ORIGIN=http://localhost:8790`          |
| Accounts | `PUBLIC_HANDLE_DOMAIN=r2d2.test`                   |
| Accounts | `PDS_ORIGIN=http://localhost:8787`                 |
| Accounts | `PLC_DIRECTORY=http://localhost:8788`              |
| PDS      | `MINISPHERE_ORIGIN=http://localhost:8790`          |
| PDS      | `PDS_ORIGIN=http://localhost:8787`                 |
| PDS      | `PLC_DIRECTORY=http://localhost:8788`              |
| Town     | `PLC_DIRECTORY=http://localhost:8788`              |
| Town     | `DEV_HANDLE_RESOLVER_ORIGIN=http://localhost:8790` |

Keep the explicit local `PLC_DIRECTORY` values above. Accounts and PDS default an omitted value to `https://plc.directory`; Town remains unchanged and requires an explicit value. An invalid explicit value fails Accounts/PDS Zod configuration validation, and failed requests never switch directories. Because PDS account creation writes persistent PLC records, accidentally omitting the local override can publish development identities to the public directory.

Setup preserves existing `.dev.vars`. Therefore existing Town checkouts still point `DEV_HANDLE_RESOLVER_ORIGIN` at the removed port 8789 and **must be updated manually to `http://localhost:8790`**. Do not set this development adapter in production.

### Configuration ownership

- `wrangler.jsonc` owns bindings, databases, Durable Objects, compatibility, fixed ports, and Worker-first asset paths.
- `.dev.vars.example` is the complete local Worker binding template used for type generation.
- ignored `.dev.vars` contains developer-owned runtime values and is never overwritten by setup.
- `.env.example` and `.env` contain frontend/build-tool settings.
- Cloudflare Dashboard owns production text variables, secrets, custom domains, and routes; `keep_vars` preserves them.

Accounts and PDS read `cloudflare:workers` environment bindings in `resolveConfig()` on demand. Their `GET /health` endpoints validate that current configuration only. They do not test D1, Durable Objects, service bindings, the PLC Directory, or other dependency availability, and return a generic error when configuration is invalid.

Accounts' SPA assets defer protocol and application endpoints to the Worker. In particular, `/.well-known/atproto-did` and `/xrpc/com.atproto.identity.resolveHandle` must not fall through to `index.html`.

### Production and Workers Builds

Follow the [deployment guide](./DEPLOYMENT.md) for runtime variables, secrets, domains, migrations, and per-Worker Builds commands. Build-time environment variables are not Worker runtime bindings. Keep `--env-file .dev.vars.example` limited to type generation, not deployment. Wrangler does not validate missing production secrets; configure every documented value before use.

## Handle and OAuth discovery

For `alice.r2d2.test`, Town sends its local XRPC lookup to Accounts at port 8790. Accounts resolves only an exact normalized hosted handle belonging to an active account. The XRPC route has CORS for browser/client use; the hostname-based `/.well-known/atproto-did` route does not add CORS. Neither route requires or reads a login session.

Town then reads the DID document from `PLC_DIRECTORY`, discovers the PDS, and discovers Accounts from PDS protected-resource metadata. Normal public handles continue to use DNS TXT and HTTPS well-known resolution.

## Setup and commands

```sh
pnpm setup:local
pnpm dev:atproto    # Accounts, PDS, and PLC Directory
pnpm dev:town       # Town with its current local configuration
pnpm dev:town:local # Town and the complete local group
pnpm dev            # Normal full local workflow
```

`setup:local` copies only missing local files, validates origins and ports, generates Worker types, and applies local migrations. The removed root `dev:handle-registry` command is no longer part of the supported workflow.

## Verification

1. Create or use an active `*.r2d2.test` account in Accounts.
2. Confirm Town resolves it through `DEV_HANDLE_RESOLVER_ORIGIN=http://localhost:8790`.
3. Confirm inactive and unknown handles return not found and the XRPC response has CORS.
4. Confirm PLC resolution selects PDS port 8787 and its metadata selects Accounts port 8790.
5. Confirm normal public handles still use standard DNS or HTTPS resolution.
6. Run `pnpm check`.
