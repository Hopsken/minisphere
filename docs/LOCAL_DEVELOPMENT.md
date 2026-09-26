# Local Development

The local AT Protocol group is Accounts, the PDS, and a private PLC Directory. Town is an independent OAuth client.

## Topology

| Component | Local origin | Role |
| --- | --- | --- |
| PDS | `http://localhost:8787` | Resource server and repository host |
| PLC Directory | `http://localhost:8788` | `did:plc` authority |
| Accounts | `http://localhost:8790` | Entryway, authorization server, and handle resolver |
| Town | `http://127.0.0.1:5174` | Independent OAuth client |

Local handles use the `r2d2.test` suffix. For `alice.r2d2.test`, Town resolves the handle through Accounts (`DEV_HANDLE_RESOLVER_ORIGIN`), reads the DID document from the local Directory, and then discovers the PDS and its authorization server through standard metadata. Public handles use normal DNS and HTTPS resolution.

## Setup

```sh
pnpm setup:local
pnpm dev
```

`setup:local` copies each missing `.dev.vars` and `.env` from its template, validates the local origins and ports, generates Worker types, and applies local migrations. It never overwrites existing files, so compare them with the templates after a template changes.

## Configuration files

- `wrangler.jsonc` — bindings, databases, Durable Objects, compatibility settings, and fixed ports.
- `.dev.vars.example` — the complete local Worker variable template, also used for type generation.
- `.dev.vars` — developer-owned local values; ignored by Git.
- `.env.example` and `.env` — frontend and build-tool settings.

Keep the explicit local `PLC_DIRECTORY=http://localhost:8788` in every `.dev.vars`. Without it, account creation publishes permanent records to the public PLC Directory.

## Verification

Run `pnpm check` before you push. To check the full flow manually, create an account in Accounts, sign in to Town with its `*.r2d2.test` handle, and create a post.
