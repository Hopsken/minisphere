# Handle Registry

The Handle Registry is a stateless Hono Cloudflare Worker that serves AT Protocol HTTPS handle verification. Accounts owns hosted handles and their DID mappings. The Worker also exposes the same mapping through `com.atproto.identity.resolveHandle` so browser clients can resolve local handles without wildcard local DNS.

## Protocol role

A PLC DID document can claim a handle in `alsoKnownAs`, but that claim does not prove that the handle owner controls the DID. AT Protocol clients verify the other direction by requesting:

```text
https://<handle>/.well-known/atproto-did
```

The Worker routes wildcard subdomains under the hosted handle domain. For `/.well-known/atproto-did`, it sends the request hostname to `AccountsEntrypoint.resolveHandle()` through a trusted service binding. It returns the DID supplied by Accounts as plain text. Unknown handles return `404`.

## Data ownership

The Handle Registry has no database and no registration API. It trusts Accounts as the authority for active username, hosted handle, and DID records. The PLC Directory remains the source of truth for DID documents and their `alsoKnownAs` claims.

## Configuration

The `Accounts` service binding targets `AccountsEntrypoint`. The production Wrangler configuration routes `*.r2d2.party/*` to this Worker. Keep this wildcard route synchronized with Accounts `PUBLIC_HANDLE_DOMAIN`.

## Development

```sh
pnpm dev:handle-registry
pnpm turbo test typecheck build --filter=@minisphere/handle-registry
```

The local Handle Registry listens on port `8789`. Its inspector port is assigned dynamically. Turbo starts Accounts and its PDS dependency with the Handle Registry.

Town forwards `.test` handle lookups from its same-origin resolver to this local XRPC endpoint. It then reads the DID document from its selected PLC Directory and discovers the user's PDS from that document.
