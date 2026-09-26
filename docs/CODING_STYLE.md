# Coding Style

This document records repository conventions. Read the general sections and the framework section for the module you are changing.

## General engineering

- Keep one source of truth. Do not persist data that belongs to another service or can be derived at the point of use.
- Make the smallest change that fully implements the behavior.
- Prefer direct framework and library APIs over local pass-through wrappers.
- Use an established package for standard protocols, formats, and cryptography. Do not create a custom format without a repository-specific requirement.
- Add a shared package only after multiple projects need the same behavior.
- Keep names precise. A name must describe the data or responsibility it owns, not a larger possible future role.
- Keep comments for invariants, ownership, or non-obvious constraints. Do not narrate the code.

## Backend service boundaries

- Separate HTTP routing, business rules, persistence, and external service access.
- Use this Worker dependency direction:

  ```text
  routes → services → repositories
                    → clients
                    → focused library functions
  ```

- Routes validate transport input and map service results to HTTP responses.
- Services own workflows and domain decisions.
- Repositories own database queries and persistence shapes.
- Clients own external APIs and Worker service-binding setup.
- Keep application-specific code in its application. Move it to a package only when ownership is genuinely shared.
- Read Worker bindings and configuration directly from the `cloudflare:workers` `env`; do not thread them through constructors or context. Pass arguments only for values that change per request. See [ADR 0009](./adr/0009-read-worker-bindings-from-the-global-env.md).

## TypeScript and schemas

- Keep strict TypeScript settings enabled.
- Define runtime contracts with Zod at I/O boundaries and infer TypeScript types from those schemas.
- Reuse the same schema on the server and client instead of duplicating validation expressions.
- Use `import type` for type-only imports.
- Prefer inferred return types when the implementation and framework already provide the precise type.
- Avoid type assertions. When an external invariant requires one, put a `SAFETY:` explanation immediately before it.
- Use configured TypeScript path aliases. Do not add separate Vite aliases for paths already defined by TypeScript.

## Cloudflare Workers and Hono

- Use Hono's fluent route composition and export the composed route type for RPC clients.
- Use the typed Hono client directly. Do not add one function per endpoint when that function only forwards arguments and unwraps JSON.
- Convert expected request errors to `HTTPException`; let the application error boundary format them consistently.
- Use `@minisphere/hono-utils` for validation behavior shared by Hono applications.
- Prefer Worker service bindings over public HTTP calls between Minisphere Workers.
- Generate service-binding types from every bound Worker's Wrangler configuration.
- Run `typegen` after a binding or named RPC entrypoint changes. Do not edit `worker-configuration.d.ts`.

## Databases and migrations

- The service that owns the source of truth owns its schema.
- Store references or explicit cache data instead of copying another service's authoritative fields.
- Keep Drizzle schemas near the service or package that owns the database.
- Give every migration a short descriptive name. Do not accept generated adjective names.
- Check in generated SQL and snapshots.
- Durable Object repository data belongs to `@minisphere/repo-do`; global PDS account state belongs to the PDS.

## React and TanStack

- Use directory-based TanStack Router routes.
- Put components used by only one route in that route's `-components` directory.
- Remove layout routes that only render an `Outlet` and do not own layout, context, or behavior.
- Split pages into focused components. Keep query loading and page composition in the route file.
- Use shared `queryOptions` and stable query-key factories.
- Put default query and mutation error reporting in the shared `QueryClient`. Add local handlers only when the interaction needs specific behavior.
- Reuse server schemas and Hono request types in forms and mutations.
- Do not edit `routeTree.gen.ts`; the TanStack Router Vite plugin owns it.

## UI and shadcn

- Install available shadcn components with the configured CLI and `components.json`.
- Keep the configured Base UI component base. Do not substitute Radix UI or hand-copy a shadcn component.
- Prefer native shadcn component APIs and design tokens over one-off component variants.
- Keep responsive behavior in the owning component and verify representative mobile and desktop states.

## Credentials and security

- Never store plaintext credentials in D1.
- Distinguish long-lived passwords from access and refresh tokens. Do not combine them into a generic credential payload.
- Persist only the credential required by the current workflow.
- Keep encryption keys in Worker secrets, separate from encrypted database values.
- Do not persist short-lived access or refresh tokens unless a workflow explicitly requires durable sessions.
- Never log plaintext credentials, private keys, tokens, or complete secret values.

## Tests and verification

- Test through public interfaces: HTTP and XRPC routes, Worker RPC entrypoints used by other services, and CLI scripts. Use the real D1, Durable Object, and R2 bindings of the Workers test runtime.
- Fake only what is outside the repository or cannot run in tests, such as Resend or a remote PLC Directory.
- Assert observable behavior: responses, and state read back through a public interface. Do not assert table layouts, internal class methods, or call counts on internal code.
- Do not test internal repositories, services, or helpers directly. Test a pure function directly only when it encodes a product rule that is hard to reach through an interface.
- Before you write a test for risky behavior, list how it could fail. Choose inputs where a wrong implementation gives a different result.
- Regenerate migrations and Worker types before test and type-check validation when their sources change.
- Run repository and read-only project checks through Turbo so task dependencies and caches remain effective.
- Use a pnpm package filter for explicit project-local write operations such as migration generation.
- Run the narrow project checks first, then repository-wide checks for shared changes.

## Documentation

- Document contracts, not implementation: ownership, interfaces, configuration, operational risks, and known limitations. Code and tests describe how it works.
- Do not record change history or migration notes in documentation. Git history and pull requests keep them.
- Keep the root README focused on repository-wide setup, navigation, and status.
- Keep project-specific interfaces, configuration, and commands in that project's README.
- Record each durable decision as an [ADR](./adr/README.md). Do not rewrite an accepted ADR; supersede it.
- Update the owning document in the same change that alters its contract.
