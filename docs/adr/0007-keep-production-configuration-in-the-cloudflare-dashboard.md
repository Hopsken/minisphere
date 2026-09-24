# 0007. Keep production configuration in the Cloudflare Dashboard

## Status

Accepted

## Context

Workers Builds deploys from the repository. If Wrangler declared production variables and routes, each deployment could overwrite values that operators set in the Dashboard. Secrets must never be in the repository.

## Decision

- The Cloudflare Dashboard owns production variables, secrets, custom domains, and routes. Wrangler keeps them (`keep_vars`) and declares no routes.
- `wrangler.jsonc` declares bindings, databases, Durable Objects, compatibility settings, and local ports.
- `.dev.vars.example` is the complete list of Worker variables. It supplies local defaults and drives type generation.
- Each Worker validates its own configuration with its own Zod schema. Accounts and the PDS derive their origins from `MINISPHERE_ORIGIN`: Accounts at that origin, the PDS at `pds.<hostname>`.

## Consequences

- Deployments never change production settings. Operators must configure each documented value before first use, because Wrangler does not check for missing secrets.
- Configuration schemas are similar across Workers but are not shared.

## References

- [Deployment guide](../DEPLOYMENT.md)
- [Local development](../LOCAL_DEVELOPMENT.md)
