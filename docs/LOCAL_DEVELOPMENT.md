# Local Development Environment

This document defines the target local-development architecture for Minisphere and the Town OAuth example. The first milestone uses the repository's Wrangler configuration and project-local variable files.

## Architecture principles

- PDS, PLC Directory, Handle Registry, and Accounts form one local AT Protocol service group.
- Town is an external client of that group and can also connect to public AT Protocol infrastructure.
- Town selects its AT Protocol topology through one `PLC_DIRECTORY_ORIGIN`.
- Stable local origins keep protocol metadata, DID documents, and OAuth redirects consistent.
- Minisphere services use Cloudflare service bindings for internal discovery.
- Project-local templates make setup reproducible while preserving developer-owned values.

## Workspace boundary

The workspace separates AT Protocol infrastructure from external examples:

```text
apps/
├── accounts
├── directory
├── handle-registry
└── pds

examples/
└── town
```

Town remains in the root pnpm and Turbo workspace. It shares the repository toolchain and CI while interacting with Minisphere through public protocol interfaces.

## Local topology

The AT Protocol service group uses one contiguous port range. Town uses an independent client port.

| Component | Local origin | Role |
| --- | --- | --- |
| PDS | `http://localhost:8787` | AT Protocol resource server and repository host |
| PLC Directory | `http://localhost:8788` | `did:plc` operation and document authority |
| Handle Registry | `http://localhost:8789` | Hosted-handle publication and local `.test` resolution |
| Accounts | `http://localhost:8790` | Account entryway and OAuth authorization server |
| Town | `http://127.0.0.1:5174` | Independent OAuth client example |

Each server uses its assigned port in strict mode. A port conflict stops startup, which keeps the absolute URLs in DID documents, OAuth metadata, and redirects aligned with the running services.

## Service discovery

Minisphere infrastructure uses service bindings for internal calls:

```text
Handle Registry ──binding──▶ Accounts
Accounts ─────────binding──▶ PDS
Accounts ─────────binding──▶ PLC Directory
PDS ──────────────binding──▶ PLC Directory
```

These bindings provide internal Worker discovery. The fixed HTTP origins represent the same services in protocol documents and browser navigation.

Town crosses the infrastructure boundary through HTTP. Its Worker provides same-origin endpoints to the browser and fetches the selected PLC Directory and discovered protocol services by origin.

## Town configuration

Town has two protocol configuration values:

- `PUBLIC_URL` — Town's canonical origin for OAuth client metadata and redirect URIs.
- `PLC_DIRECTORY_ORIGIN` — the selected `did:plc` directory.

Town also supports one local-development transport value:

- `DEV_HANDLE_RESOLVER_ORIGIN` — an XRPC resolver for handles ending in `.test`.

`PLC_DIRECTORY_ORIGIN` is Town's AT Protocol topology selector. The resolved DID document supplies the PDS service endpoint, and the PDS protected-resource metadata supplies the authorization server. `DEV_HANDLE_RESOLVER_ORIGIN` only maps the reserved `.test` namespace onto the local Handle Registry transport.

Town's runtime resources are its Worker, static assets, and configuration variables. All identity and repository state stays with the selected AT Protocol services.

## Identity and OAuth discovery

Login starts with the handle entered by the user and follows standard protocol discovery:

```text
user handle
    │
    ▼
handle resolution
    │
    ▼
did:plc identifier
    │
    ▼
PLC_DIRECTORY_ORIGIN
    │
    ▼
DID document
    │
    ▼
PDS service endpoint
    │
    ▼
OAuth protected-resource metadata
    │
    ▼
authorization server
```

Town uses Atcute for handle resolution, DID resolution, OAuth discovery, PAR, PKCE, DPoP, authorization-code exchange, and identity verification.

The browser calls Town's same-origin `com.atproto.identity.resolveHandle` endpoint. Town's Worker then selects the resolution transport:

| Handle                   | Resolution transport                           |
| ------------------------ | ---------------------------------------------- |
| Normal public handle     | Atcute DNS TXT and HTTPS well-known resolution |
| Handle ending in `.test` | XRPC at `DEV_HANDLE_RESOLVER_ORIGIN`           |

A `.test` lookup requires the development resolver value. An absent value produces an immediate local configuration error before resolver traffic. The suffix match uses the `.test` label boundary.

After handle resolution returns a DID, Town reads its DID document through `PLC_DIRECTORY_ORIGIN` and verifies that `alsoKnownAs` links the DID back to the entered handle. The same-origin Worker endpoint also gives the browser a consistent CORS boundary for PLC reads.

## Local handles

Accounts publishes local handles under this reserved development domain:

```text
PUBLIC_HANDLE_DOMAIN=r2d2.test
```

A local account can therefore use a stable handle such as:

```text
alice.r2d2.test
```

Accounts records that handle in the local PLC operation and DID document. Town resolves the handle through the Handle Registry, obtains the DID, and continues through the selected PLC Directory, local PDS, and local Accounts authorization server.

The `.test` namespace follows the AT Protocol handle specification for examples, tests, and development.

## Town workflows

### Full local workflow

Town uses these values:

```text
PUBLIC_URL=http://127.0.0.1:5174
PLC_DIRECTORY_ORIGIN=http://localhost:8788
DEV_HANDLE_RESOLVER_ORIGIN=http://localhost:8789
```

The resulting discovery chain is:

```text
*.r2d2.test
  → local Handle Registry
  → local PLC Directory
  → local PDS
  → local Accounts
```

### Public infrastructure workflow

Town can run locally with a public PLC Directory:

```text
PUBLIC_URL=http://127.0.0.1:5174
PLC_DIRECTORY_ORIGIN=https://plc.directory
```

Normal public handles use standard DNS or HTTPS resolution. Their DID documents select the public PDS, and PDS metadata selects its authorization server. This workflow verifies Town's client implementation against public protocol infrastructure.

Changing Town's project-local variable file selects the workflow.

## Configuration ownership

Each configuration file has one responsibility.

### `wrangler.jsonc`

- Worker bindings, databases, Durable Objects, and compatibility settings.
- `keep_vars: true` to preserve production variables configured in Cloudflare.
- Fixed development ports for Wrangler-owned servers.

### `.dev.vars.example`

- Complete local Worker-variable and secret template for one project.
- Local origins that correspond to the fixed topology.
- Development-only placeholder secrets.
- Variable names for `wrangler types --env-file .dev.vars.example`, independent of developer-owned files.

### `.dev.vars`

- Developer-owned local values copied from `.dev.vars.example`.
- Git-ignored project configuration.
- Existing values preserved by setup commands.

### `.env.example` and `.env`

- Development-tool settings such as Vite host allowlists.
- Frontend and build-tool configuration kept separate from Worker runtime variables.

Each application owns its credentials. Shared local origins are explicit integration contracts, and the setup workflow validates them against the assigned ports.

### Production and Workers Builds

Follow the [deployment guide](./DEPLOYMENT.md) for first-time setup, runtime values, migration order, and per-Worker Builds commands.

Configure runtime values in each Worker's **Settings → Variables and Secrets**, using the variable and secret lists in its README. Builds' environment variables are build-time values, not Worker runtime bindings. Never upload `.dev.vars.example` values as production secrets.

Configure custom domains and the Handle Registry wildcard route in **Settings → Domains & Routes**. Wrangler configurations omit `route` and `routes` so deployment leaves Dashboard-managed routes in place. `keep_vars: true` preserves Dashboard-managed variables; Wrangler also preserves existing secrets.

Before the first deployment with this configuration, verify that all runtime values and routes exist in Cloudflare. Existing deployments should already have the former Wrangler variables, but check them before deploying. Worker names, D1 IDs, and service bindings remain in Wrangler configuration and must match the target Cloudflare account. Workers Builds can keep its existing build and deploy commands; it does not need a `.dev.vars` file.

The `secrets` configuration is intentionally absent: `secrets.required` would filter out local variables no longer declared in `vars`. Type generation reads the committed template explicitly and emits string bindings without reading private local values. This also means Wrangler no longer validates a required-secret list on deployment; configure every documented production value before use. Keep `--env-file .dev.vars.example` limited to type generation, not deployment.

## Integration contracts

The local service group aligns these values:

| Owner           | Contract                                           |
| --------------- | -------------------------------------------------- |
| Accounts        | `PUBLIC_URL=http://localhost:8790`                 |
| Accounts        | `PUBLIC_HANDLE_DOMAIN=r2d2.test`                   |
| Accounts        | `PDS_ORIGIN=http://localhost:8787`                 |
| PDS             | `PDS_ORIGIN=http://localhost:8787`                 |
| PDS             | `ACCOUNTS_ORIGIN=http://localhost:8790`            |
| Handle Registry | Accounts service binding                           |
| Town            | `PLC_DIRECTORY_ORIGIN=http://localhost:8788`       |
| Town            | `DEV_HANDLE_RESOLVER_ORIGIN=http://localhost:8789` |

The PLC documents created for local accounts use the same PDS origin. OAuth metadata emitted by the PDS uses the same Accounts origin.

## Setup workflow

The root setup command performs the complete repeatable setup:

1. Find project-local `.dev.vars.example` and `.env.example` files.
2. Create each untracked local file when needed and preserve existing files.
3. Validate the fixed ports and cross-service origins.
4. Generate Worker binding types.
5. Apply local database migrations.

```sh
pnpm setup:local
```

This command prepares both the service group and Town from a fresh checkout while retaining each developer's existing local values.

`setup:local` sets `CI=true` for its Turbo invocation so Wrangler accepts migration confirmation without input. Each migration command explicitly uses `--local`; setup does not access production databases. Running a project's migration command directly retains Wrangler's default confirmation behavior.

## Development commands

The root workspace exposes commands for each useful boundary:

```sh
pnpm dev:atproto    # PDS, PLC Directory, Handle Registry, and Accounts
pnpm dev:town       # Town with its current project-local configuration
pnpm dev:town:local # Town and the complete local AT Protocol service group
pnpm dev            # Normal full local workflow
```

Turbo starts the four infrastructure services explicitly for `dev:atproto`. Their package-level dependency relationships continue to represent service bindings. Town remains independently runnable through `dev:town`.

## Verification

The architecture is ready when these checks pass:

1. A `.test` account completes login through the local Handle Registry, PLC Directory, PDS, and Accounts.
2. A `.test` lookup with an incomplete local configuration returns an immediate local error before public resolution.
3. A normal handle resolves through standard DNS or HTTPS discovery.
4. Local Town authenticates a public account through a configured public PLC Directory.
5. PLC selection determines the PDS, and PDS metadata determines the authorization server.
6. Town reaches protocol services through public HTTP discovery.
7. Every local server reports a port conflict and exits.
8. `pnpm check` passes for the complete workspace.
