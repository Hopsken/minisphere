# 0004. Create accounts through the Entryway flow

## Status

Accepted

## Context

Account creation touches Accounts, the PDS, repository storage, and the PLC Directory. Any call can fail or time out after its side effect has happened. A blind retry could create a second DID for one username, and a PLC record cannot be deleted.

## Decision

Account creation follows the AT Protocol Entryway flow over standard XRPC:

1. The PDS reserves a repository signing key (`com.atproto.server.reserveSigningKey`) and returns only the public key.
2. Accounts creates a per-account rotation key, signs the genesis PLC operation, and derives the DID. It stores this material in one conditional write before it calls the PDS.
3. Accounts gets a one-time invite from the PDS `PdsControlPlane` RPC entrypoint and calls `com.atproto.server.createAccount`. The PDS trusts the supplied DID and operation, creates the repository, and submits the operation to the PLC Directory.
4. Accounts activates the account only after the PDS repository and the PLC state match the stored material.

- A retry reuses the stored DID and signed operation. There is no private operation ID or lock.
- After Accounts stores the material, a failure never releases it, because another request may still be creating the same identity.
- An invite is a bearer credential. It stays spent after a later failure.

## Consequences

- One username never produces two identities, even with concurrent requests and unknown outcomes.
- The PDS trusts Accounts for the correctness of the identity material. The invite authorizes the call.
- An account can stay in `provisioning` until a retry confirms it.

## References

- [ADR 0006](./0006-keep-private-keys-in-server-managed-custody.md)
- [Accounts README](../../apps/accounts/README.md#accounts-and-handles)
- [PDS README](../../apps/pds/README.md#account-creation)
