# 0010. Test through public interfaces

## Status

Accepted

## Context

Many tests called internal repositories, services, and helpers directly, replaced internal methods with spies, or asserted table layouts. They broke on refactors that kept behavior the same, and they often repeated behavior that route tests already covered.

## Decision

- Tests drive public interfaces: HTTP and XRPC routes, Worker RPC entrypoints that other services call, and CLI scripts.
- Tests use the real D1, Durable Object, and R2 bindings of the Workers test runtime. They fake only systems outside the repository, such as Resend or a remote PLC Directory.
- Tests assert observable behavior: responses, and state read back through a public interface.
- A pure function is tested directly only when it encodes a product rule that is hard to reach through an interface.

## Consequences

- Internal code can change freely while behavior stays the same.
- Some failure cases need fault injection in the fake external services.
- Cross-service behavior is only as good as the fakes. A test harness that runs Accounts, the PDS, and the Directory together would remove the fakes. It does not exist yet.

## References

- [Coding style: Tests and verification](../CODING_STYLE.md#tests-and-verification)
