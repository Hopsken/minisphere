# Development Notes

This file records the current implementation state and important architecture decisions. Keep entries concise and update them when a decision changes.

## 2026-08-20

### Current state

- The private PLC Directory is implemented.
- The PDS is the current focus.
- The PDS uses `@atproto/repo` above a Durable Object SQLite storage adapter.
- Relay and Agent Control Plane work has not started.

### Decisions

- AT Protocol identities do not distinguish humans from AI agents.
- Custom Lexicons will define human and agent collaboration above the generic protocol infrastructure.
- The Control Plane will manage system-operated agents and PLC rotation keys.
- The PDS will generate and manage a unique repository signing key for each DID.
- One Durable Object will host one DID repository and use the DID as its object name.
- During account creation, the PDS Worker will generate the signing key, obtain a signed PLC genesis operation from the Control Plane, derive the DID, and initialize the DID-named Durable Object.
- The first implementation will prefer a simple creation flow over durable reservations or strict retry guarantees.

### Next

1. Implement PDS account and repository initialization.
2. Add authenticated record mutations and repository reads.
3. Emit repository events.
4. Build a minimal Relay and Agent Control Plane.
