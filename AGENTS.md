# Repository Guidelines

- Read [Coding Style](./docs/CODING_STYLE.md) before changing code. Apply its general rules and the framework-specific section for the module you edit.
- Read the owning project's README for project-specific architecture, setup, bindings, and commands.
- Architecture decisions are indexed in [docs/adr/README.md](./docs/adr/README.md). Until the ADR migration is complete, use [DEVELOPMENT.md](./DEVELOPMENT.md) for current status and existing decisions.
- Update the owning documentation when a change affects architecture, storage ownership, configuration, setup, or development workflow.
- For local Accounts browser tests, open `https://localhost:8790/__dev/log-me-in/dev@example.com?returnTo=/` in the browser session used for tests. A `curl` request does not sign that browser in.
