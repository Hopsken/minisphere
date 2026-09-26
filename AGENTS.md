# Repository Guidelines

- Read [Coding Style](./docs/CODING_STYLE.md) before changing code. Apply its general rules and the framework-specific section for the module you edit.
- Read the owning project's README for project-specific architecture, setup, bindings, and commands.
- Read the [Architecture Decision Records](./docs/adr/README.md) for service ownership and trust boundaries. Record a new durable decision as a new ADR.
- Update the owning documentation when a change affects a contract: ownership, interfaces, configuration, setup, or development workflow. Do not document implementation details.
- For local Accounts browser tests, open `http://localhost:8790/__dev/log-me-in/dev@example.com?returnTo=/` in the browser session used for tests. A `curl` request does not sign that browser in.

## UI and UX Principles

- Apply professional UI/UX judgment to visuals and interaction, not just information structure. Make the main action clear, keep controls accessible, and remove unnecessary text and decoration. Trust users to understand familiar tasks.
