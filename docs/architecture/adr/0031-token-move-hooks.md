# 0031 — Token-changed hooks also run on token moves

- Status: accepted (2026-10-13; decisions-log #154)
- Date: 2026-10-13
- Amends: [ADR-0028](0028-token-changed-hooks.md) ("Moves and placement don't run hooks")
- Affects: [scenes-map](../../specs/scenes-map.md) (FR-MAP-30, FR-MAP-38), [combat-tracker](../../specs/combat-tracker.md) (FR-CBT-39), [protocol](../../protocol/README.md) §16, §25
- Raised by: DM feedback F3, movement tracker ([feedback-phase3](../../agents/feedback-phase3.md), tier S #148); [OQ-MAP-25](../../specs/scenes-map.md#15-open-questions)

## Context

- F3: in combat, track **movement used this turn** per combatant: the sum of each move's 5/10/5 cell distance since the combatant's turn started; reset on Next. Indicators only, never block.
- DM and the token's owner must see the same number, and it must survive a reload, reconnect and crash. So it is combat state on the `combatant` row (`movedFt`).
- Moves are `map.moveToken` (scenes-map). Combat must update `movedFt` in the **same transaction**: listeners never mutate state ([ADR-0016](0016-domain-events-pending-actions.md)).
- ADR-0028 runs token-changed hooks in update / hide / delete, and explicitly not in moves ("no copies depend on position"). That is no longer true.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Run the existing token-changed hooks in `map.moveToken` too** | One registry, one pattern; atomic; scenes-map stays unaware of combat | Every move runs the hooks (one indexed lookup each); hooks must tell a move from an edit (`before.col/row ≠ after.col/row`) |
| B. A separate token-moved hook registry | Hooks stay single-purpose | Second registry and AGENTS §9.9 entry for one consumer |
| C. Client sends `cbt.recordMove` after the drop | No scenes-map change | Two commits; a drop between them or a crash loses movement; racy with the next drag |
| D. Client-only tracking | No server change | DM and player disagree; lost on reload |

## Decision

**A** (#154). `map.moveToken` runs every registered token-changed hook `(env, before, after)` inside its transaction; returned rows go into `TokenMoved`'s `changes`.

| Rule | Detail |
|---|---|
| Logging | `TokenMoved` stays **unlogged** ([ADR-0016](0016-domain-events-pending-actions.md)): hook rows ride on it, the state tables are the truth |
| Rejects | A hook must not reject a move (movement indicators never block, #145). A throw → `internal`, the move rolls back, the client overlay reverts |
| Still not run | Placement and duplicate |
| Combat's hook | Token bound to an active, non-removed combatant: `movedFt += distance(before, after)` (5/10/5, FR-MAP-22), capped at 9,999; nothing else on a move |

## Consequences

- scenes-map FR-MAP-30 "Moves … run none" superseded by FR-MAP-38; combat-tracker FR-CBT-39.
- Protocol §25 "Not run" row loses "Moves"; §16 `TokenMoved` changes gain hook rows (combat: `combatant`).
- Players receive a `combatant` upsert with each in-combat move (≤ 300 B).
- **Hooks may run as a player actor** (`env.actor.role = player`) and on an **optimistic** intent: `map.moveToken` is DM + owning player, and the client has already moved the token. Every other hook caller is DM-only; hooks must not assume a DM actor or DM-only data access.
- `map.moveToken` becomes a hook-taking factory, like `updateTokenCommand(hooks)`.
- Combat's existing hook skips when name, image and hidden are unchanged (always true on a move); the `movedFt` branch sits before that check (or is a second registry line).
- **"Never reject a move"** can't be enforced by the registry signature. It is a review check plus a test: a player move of a bound active combatant's token succeeds and updates `movedFt`.
- Tests: a test-registered hook runs on move, its rows are in `TokenMoved.changes`, no event-log row; a throwing hook rolls the move back.
