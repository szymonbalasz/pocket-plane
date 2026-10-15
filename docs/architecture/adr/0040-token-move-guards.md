# 0040 — Token move guards (a move may be refused)

- Status: accepted (2026-10-15; decisions-log #196)
- Date: 2026-10-15
- Amends: [ADR-0031](0031-token-move-hooks.md) ("a hook must not reject a move")
- Affects: [scene-tools](../../specs/scene-tools.md) (FR-SCN-10/11), [scenes-map](../../specs/scenes-map.md) (FR-MAP-15, FR-MAP-38), [combat-tracker](../../specs/combat-tracker.md) (FR-CBT-39), [protocol](../../protocol/README.md) §25, [AGENTS §9.9](../../../AGENTS.md#99-shared-files)
- Raised by: [OQ-SCN-13](../../specs/scene-tools.md#15-open-questions)

## Context

- Walls and closed doors must refuse a **player's** token move server-side (sprint 2 track B, #187); the DM always moves through.
- `map.moveToken` runs token-changed hooks (ADR-0031), which must never reject: movement indicators never block (#145), and combat's hook relies on it.
- The check must read committed state at drop (a door closed mid-drag), inside the move's transaction.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. New append-only `moveGuards` registry in scenes-map: `(env, token, from, to) → void`, may throw a reject; run in `map.moveToken` before the write and before hooks** | Hooks stay non-rejecting; one clear "may refuse" seam; atomic | Second registry on the move path |
| B. Let token-changed hooks reject moves | One registry | Breaks ADR-0031's guarantee for every hook; combat's `movedFt` may be written then rolled back |
| C. Client-only check | No server change | Not enforced; players can't see walls (FR-SCN-14) |

## Decision

**A** (#196, DM gate 2).

## Consequences

- `map.moveToken` = validate → **guards** (may refuse) → FOG's `derive` (`fogged`) → one write → token-changed hooks → `TokenMoved` (seam S4, review X7). A guard reject: no write, no hook, no event, no `ack`; the client reverts (FR-MAP-15).
- Guards run for every actor; each guard decides (scene-tools' wall guard returns at once for the DM).
- Guards are read-only (review check + test). Placement, `placeTokenIn` and duplicate run none.
- ADR-0031's "a hook must not reject a move" stays true for hooks.
- `src/server/features/scenes-map/move-guards.ts` (created by `fix/scn-core`) joins the AGENTS §9.9 append-only list.
