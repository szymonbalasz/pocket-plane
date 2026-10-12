# 0028 — Token-changed hooks keep bound instances in step

- Status: accepted (2026-10-12; decisions-log #134, #137)
- Date: 2026-10-12
- Affects: [scenes-map](../../specs/scenes-map.md) (FR-MAP-05, -18, -19), [combat-tracker](../../specs/combat-tracker.md) (FR-CBT-09), [protocol](../../protocol/README.md) §17, [AGENTS §9.9](../../../AGENTS.md#99-shared-files)
- Extends: [ADR-0024](0024-definition-visibility.md) (definition-changed hooks), [ADR-0021](0021-sync-protocol-conventions.md) ("visibility fns read only the record and the connection context")
- Raised by: [OQ-CBT-17](../../specs/combat-tracker.md#15-open-questions); answers OQ-MAP-03, OQ-MAP-11 (decisions #124)

## Context

- A combatant bound to a hidden token must be hidden from players too (#76). Visibility fns read only their own record, so the combatant needs its own `hidden` copy, written whenever the token's flag changes.
- Same for the display copies (name, image) the player initiative view shows, and for the token-delete rule combat-tracker owns (#124).
- Copies must change in the **same transaction** as the token, or a crash leaves a hidden token with a visible combatant (a leak). Listeners never mutate state ([ADR-0016](0016-domain-events-pending-actions.md)).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Server hook registry in scenes-map: `(ctx, before, after \| null) → RecordChange[]`, may throw a reject; run inside `map.updateToken`, `map.setTokenHidden`, `map.deleteToken` and scene delete (per token); returned rows listed in the token event's `changes`** | Same pattern as FR-ENT-19; atomic; scenes-map stays unaware of combat | Every token command must call the registry; scenes-map (complete) gains one FR |
| B. Combat-tracker gets its own hide/reveal intent; DM keeps both in step | No scenes-map change | Double work every reveal; easy to forget → leaks a hidden enemy |
| C. Visibility fn reads the bound token | No copies | Contradicts ADR-0021; reveal must list dependants |

## Decision

**A** (#134). scenes-map token commands run registered token-changed hooks inside their own transaction (as definition-changed hooks, FR-ENT-19); combat copies name / image / hidden onto bound combatants; deleting a token bound to a running encounter answers `conflict`. Registry is append-only (AGENTS §9.9), created by `build/scenes-map`.

## Consequences

- scenes-map: one FR ("token commands run registered token-changed hooks in their transaction; a hook error rolls back the command"), no behaviour change when no hook is registered.
- combat-tracker registers one hook: copies name / image / hidden to bound active combatants; deleting a token bound to an active combatant → `conflict`; otherwise sets the combatant's `tokenId` null.
- `TokenHidden`, `TokenRevealed`, `TokenUpdated`, `TokenDeleted`, `SceneDeleted` may carry `combatant` changes; protocol §16/§17 gain a row each.
- Moves and placement don't run hooks (no copies depend on position).
