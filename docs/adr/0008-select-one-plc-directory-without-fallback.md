# 0008. Select one PLC Directory without fallback

## Status

Accepted

## Context

A deployment can use the public `https://plc.directory` or the private Directory in this repository. PLC writes are public and permanent. If a service silently switched directories after a failure, identities would split across two authorities.

## Decision

- Accounts, the PDS, and Town each read `PLC_DIRECTORY`. When it is omitted, they use `https://plc.directory`.
- An invalid value fails configuration validation. A failed request never switches to another directory.
- All services in one deployment use the same directory. Local templates select the local Directory explicitly.

## Consequences

- A production deployment works with the public directory without extra configuration.
- A local or test environment that omits the value would publish permanent records to the public directory. Templates and tests must set it.
- Moving an existing network to another directory needs an identity migration, such as the Directory's `migrate:genesis` script.

## References

- [Directory README](../../apps/directory/README.md)
