# Protocol

Consolidated REST (Hono RPC) + WebSocket event catalogue. **Living doc**: the integrator extends it after each build phase's specs reach `complete`, alongside the [data model](../data-model/README.md) ([process](../process.md#stages)).

> TODO (spec phase): populate from Foundation specs first, then extend per phase. Don't edit from a feature worktree.

## Inputs

- Section 9 (API & events) of every [MVP spec](../specs/README.md).
- [live-sync](../specs/live-sync.md) envelope and visibility conventions.
- [ADR-0005](../architecture/adr/0005-server-authoritative-sync.md).

## Will contain

- Auth: DM secret and player link handshake.
- REST routes by resource.
- WS intent catalogue: name, payload schema, who may send, ownership check.
- WS event catalogue: name, payload schema, **visibility rule**.
- Snapshot shape.
- Error codes.
- Versioning policy.

## Conflicts log

| Message | Specs in conflict | Resolution |
|---|---|---|
