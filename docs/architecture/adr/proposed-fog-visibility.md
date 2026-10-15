# Proposed — Fog visibility: server-written `fogged` copies, scene visibility and lifecycle hook registries

- Status: proposed (spec-fog-of-war; integrator numbers it at acceptance)
- Date: 2026-10-15
- Affects: [fog-of-war](../../specs/fog-of-war.md), [scenes-map](../../specs/scenes-map.md) (token fn, `map.drag` audience, scene create / duplicate / delete, size refresh), [scene-tools](../../specs/scene-tools.md) (props, AoE templates, doors, `sceneHooks`), [combat-tracker](../../specs/combat-tracker.md) / [combat-extras](../../specs/combat-extras.md) (hidden copies), [protocol](../../protocol/README.md), [AGENTS §9.9](../../../AGENTS.md#99-shared-files)
- Extends: [ADR-0021](0021-sync-protocol-conventions.md) (visibility reads record + context), [ADR-0024](0024-definition-visibility.md) (display copies), [ADR-0028](0028-token-changed-hooks.md) / [ADR-0031](0031-token-move-hooks.md) (token-changed hooks), [ADR-0033](0033-signal-audience.md) (signal audience)
- Amends: [ADR-0016](0016-domain-events-pending-actions.md) undo scope ("not scene edits") for fog edits (with scene-tools' drawing undo: one DM question, OQ-FOG-08 / OQ-SCN-08)
- Raised by: OQ-FOG-07, OQ-FOG-08 ([fog-of-war §15](../../specs/fog-of-war.md#15-open-questions)); carried pick "token under fog hidden from players, filtered server-side" ([scene-tools](../../specs/scene-tools.md)); review-phase2 X4, X7, BO5

## Context

- Records wholly under fog (tokens, props, DM-placed AoE templates) must never reach a player socket. Hiding them in the client leaks them to dev tools.
- Visibility fns read only the record and the connection context (ADR-0021). "Under fog" depends on another record (the scene's fog), so a fn can't compute it.
- Two specs own the subject types (scenes-map tokens; scene-tools props and templates). Editing each fn per feature repeats the leak risk, so sprint-2 prefers an append-only hook registry.
- A move into fog must not send the new position first and a `delete` after: the token's own change must already carry the fog state.
- Combat copies a token's `hidden` onto combatants and effects (ADR-0028). A fog-hidden monster would otherwise reach the player Initiative with its name and `tokenId`.
- Fog (new scenes fogged, duplicate copies fog, delete lists the fog delete) and scene-tools (duplicate / delete of their rows) both need scene lifecycle hooks.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Server-written `fogged` copy on each fog subject + scenes-map registries: `visibility-hooks.ts` (`derive` before writes, `hides` in visibility fns, `dragToDm` in `map.drag`'s audience) and `scene-hooks.ts` (create / duplicate / delete)** | Fns stay pure (ADR-0021); one rule for every subject type; atomic with the write (crash-safe); a move into fog is one `delete`; same pattern as ADR-0024 / 0028 copies | One column per subject table; every subject write path calls `derive`; fog commands re-check every subject on the scene |
| B. In-memory fog cache read by visibility fns (like the active-scene resolver) | No columns | Contradicts ADR-0021; the transition matrix needs the before state of the cache; a reveal still lists every dependant |
| C. Edit scenes-map's token fn and scene-tools' fns directly, each reading a copy | No registry | Every later rule edits the fns again; two specs touch one fn |
| D. Client-side hiding | Trivial | Leaks to dev tools; rejected by the carried pick |

**Fog undo**

| Option | Pros | Cons |
|---|---|---|
| **A. Own per-scene LIFO stack of previous masks (≤ 20), persisted, `expectedEditId` guard, no redo** | Cheap (restore a mask); survives reload and crash; mirrors combat undo's guard | A second undo mechanism beside ADR-0016's compensating events |
| B. ADR-0016 compensating events | One mechanism | Needs inverse diffs per edit; ADR-0016 says scene edits are not undoable |
| C. No undo | Nothing to build | A slip spoils the next room |

## Decision (proposed)

**A** and **undo A.**

**Copies**

- Each fog subject table gains `fogged` (bool), written only by the server: true iff every footprint cell is fogged.
- Template footprints use **uncut** cells, so a map change never leaves `fogged` stale.
- It is written in the same transaction by:
  - fog commands;
  - through `derive`, every write of a subject's scene, cell or size.
- `map.moveToken` order: guards (scene-tools' `moveGuards`) → `derive` → one write → token-changed hooks.

**Registries** (scenes-map's, append-only, created empty by `fix/fog-core`)

| Registry | Member | Signature | Runs in |
|---|---|---|---|
| `src/server/features/scenes-map/visibility-hooks.ts` (`sceneVisibilityHooks`) | `derive?` | `(read, obj {type, sceneId, cells: {col, row, w, h} \| [c, r][]}) → {fogged?}`; reads only | The writing command's transaction, before the single write (via `deriveSceneObject(read, obj)`); scene-tools' `scn.template` audience |
| | `hides?` | `(type, record) → boolean`; reads only the record; the same answer for every player | Every fog subject's visibility fn |
| | `dragToDm?` | `(read, token, at {col, row} \| null) → boolean`; `null` = an `end` frame | `map.drag` audience |
| `src/server/features/scenes-map/scene-hooks.ts` (`sceneHooks`) | `created?` | `(env, scene) → RecordChange[]` | `map.createScene`'s transaction; changes join `SceneCreated` |
| | `duplicated?` | `(env, source, copy) → RecordChange[]` | `map.duplicateScene`'s transaction; changes join `SceneDuplicated` |
| | `deleting?` | `(env, scene) → RecordChange[]` | `map.deleteScene`'s transaction, **before** any row is deleted; changes join `SceneDeleted` |

- **Run order:** list order. A throw rolls the command back. No line registered → no behaviour change.
- scenes-map exports `deriveSceneObject`, `tokenHiddenForPlayers(token)` (= `hidden` or any `hides`) and `runTokenChangedHooks`.

**Who appends**

| Registry | Fog's lines | Scene-tools' lines | Created by |
|---|---|---|---|
| `visibility-hooks.ts` | `derive`, `hides`, `dragToDm` | — (calls `deriveSceneObject`, consults `hides`) | `fix/fog-core` |
| `scene-hooks.ts` | `created` (fully fogged row), `duplicated` (copy the row, not the stack), `deleting` (the `fog` delete) | `duplicated`, `deleting` (structure, props) | `fix/fog-core` |
| `move-guards.ts`, `canvas-tools.ts` | Fog tool line in `canvas-tools.ts` | owners | `fix/scn-core` |

**Effects**

- Scenes-map's token fn and scene-tools' prop / template fns return `hidden` when `hidden` or any `hides` is true.
- `map.drag` routes `"dm"` when any `dragToDm` is true.
- A DM-placed ephemeral template wholly in fog routes `"dm"`.
- Walls are not fog subjects. Doors: a per-door flag set by fog's re-derive and `scn.addDoor`, dropped by the player redaction (scene-tools OQ-SCN-06 pick).
- **Combat:** every write of a combatant's or effect's hidden copy uses `tokenHiddenForPlayers` (subject to OQ-FOG-07). Fog commands and the definition-changed size refresh run the token-changed hooks for tokens whose fog-hidden value flips.
- **Undo:** fog undo is a per-scene stack, separate from ADR-0016 undo. ADR-0016's "not scene edits" gains "fog edits (own stack)" and, if the DM agrees, scene-tools' client inverse intents (OQ-SCN-08).

## Consequences

- Shared changes:
  - schema: `token.fogged` and the fog tables; scene-tools creates its tables with `fogged` in `fix/scn-core`, after `fix/fog-core`;
  - scenes-map's token write paths, `tokenVisibility`, `drag.ts`, scene create / duplicate / delete, the size refresh;
  - AGENTS §9.9 gains `visibility-hooks.ts`, `scene-hooks.ts`, `move-guards.ts`, `canvas-tools.ts`.
- ADR-0028 / 0031: token-changed hooks also run inside fog commands and the size refresh, per flipped token.
- ADR-0033: the `map.drag` and `scn.template` audiences consult the registry.
- Combat-tracker (FR-CBT-08, -09, -64, -65) and combat-extras (FR-CBTX-13, -44, -45) are amended if OQ-FOG-07 picks it.
- Protocol:
  - a new record type `fog` (scope `scene`, never windowed);
  - the token wire gains `fogged`, sent only when true;
  - `SceneCreated` / `SceneDuplicated` / `SceneDeleted` carry `sceneHooks` rows;
  - a CON-44 budget row.
- Glossary: **Undo** covers combat, fog and scene drawing; **Fog** is reworded (OQ-FOG-16).
- Fog-hidden records reach no player through snapshots, events, signals or `sync.loadScene` results. Leak tests scan all four.
