# 0006. Keep private keys in server-managed custody

## Status

Accepted

## Context

Accounts must sign PLC operations and OAuth access tokens. The PDS must keep repository signing keys between reservation and account creation. Users do not hold their own keys in this system.

## Decision

- Private keys stored in D1 are encrypted with AES-GCM under a Worker secret: `ACCOUNTS_ENCRYPTION_KEY` in Accounts and `PDS_ENCRYPTION_KEY` in the PDS. The authenticated data binds each ciphertext to its use: the account and purpose in Accounts, and the public key in the PDS.
- Each account has its own PLC rotation key.
- Signing fails closed when a key cannot be read or decrypted. A key is never replaced automatically.

## Consequences

- An operator with access to the Worker secrets controls every account. This is custody, not protection from administrators.
- Losing or changing an encryption secret makes the stored keys unreadable. Operators must back up the secrets separately from D1.
- Key rotation, key export, and account recovery need separate work.

## References

- [ADR 0004](./0004-create-accounts-through-the-entryway-flow.md)
- [Accounts README: Configuration](../../apps/accounts/README.md#configuration)
