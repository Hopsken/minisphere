# 0009. Read Worker bindings from the global `env`

## Status

Accepted

## Context

Cloudflare Workers expose bindings and variables through the `env` export of `cloudflare:workers`. These values are fixed for the life of a Worker. Passing them through Hono context and constructors adds boilerplate at every layer and does not make them easier to change.

## Decision

- Code reads bindings and configuration directly from the `cloudflare:workers` `env`, where it needs them.
- Configuration resolvers read `env` when called, not at module load.
- Constructor and function arguments carry only values that change per request or per call.

## Consequences

- Services need less wiring code.
- Tests change bindings with `withEnv` from `cloudflare:workers`, not by injecting dependencies. This fits [ADR 0010](./0010-test-through-public-interfaces.md).
- Code that reads `env` runs only inside the Workers runtime.

## References

- [Coding style: Backend service boundaries](../CODING_STYLE.md#backend-service-boundaries)
