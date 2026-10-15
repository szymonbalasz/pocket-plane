# Proposed — Fog visibility: server-written `fogged` copies and a scenes-map visibility hook registry

- Status: proposed (spec-fog-of-war; integrator numbers it at merge)
- Date: 2026-10-15
- Affects: [fog-of-war](../../specs/fog-of-war.md), [scenes-map](../../specs/scenes-map.md) (token fn, `map.drag` audience, scene create / duplicate), [scene-tools](../../specs/scene-tools.md) (props, AoE templates, `sceneHooks`, `moveGuards`), [combat-tracker](../../specs/combat-tracker.md) / [combat-extras](../../specs/combat-extras.md) (hidden copies), [protocol](../../protocol/README.md), [AGENTS §9.9](../../../AGENTS.md#99-shared-files)
- Extends: [ADR-0021](0021-sync-protocol-conventions.md) (visibility reads record + context), [ADR-0024](0024-definition-visibility.md) (display copies), [ADR-0028](0028-token-changed-hooks.md) / [ADR-0031](0031-token-move-hooks.md) (token-changed hooks), [ADR-0033](0033-signal-audience.md) (signal audience)
- Amends: [ADR-0016](0016-domain-events-pending-actions.md) undo scope ("not scene edits") for fog edits only
- Raised by: OQ-FOG-07, OQ-FOG-08, OQ-FOG-10 ([fog-of-war §15](../../specs/fog-of-war.md#15-open-questions)); carried pick "token under fog hidden from players, filtered server-side" ([scene-tools stub](../../specs/post-mvp/scene-tools.md))

## Context

- Records wholly under fog (tokens, props, DM-placed AoE templates) must never reach a player socket. Hiding them in the client leaks them to dev tools.
- Visibility fns read only the record and the connection context (ADR-0021). "Under fog" depends on another record (the scene's fog), so a fn can't compute it.
- Three record types from two specs (scenes-map tokens, scene-tools props and templates) need the same rule; editing each fn per feature repeats the leak risk (sprint-2 boundaries: prefer an append-only hook registry).
- A move into fog must not send the new position first and a `delete` after: the token's own change must already carry the fog state.
- Combat copies a token's `hidden` onto its combatant (ADR-0028); a fog-hidden monster otherwise shows in the player Initiative with its `tokenId`.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Server-written `fogged` copy on each fog subject + scenes-map `sceneVisibilityHooks` registry (`derive` before writes, `hides` in visibility fns, `dragToDm` in `map.drag`'s audience); new scenes fogged through the scene lifecycle registry `sceneHooks`** | Fns stay pure (ADR-0021); one rule for every subject type; atomic with the write (crash-safe); a move into fog is one `delete`; same pattern as ADR-0024 / 0028 copies | One column per subject table; every subject write path must call `derive`; fog commands re-check every subject on the scene |
| B. In-memory fog cache read by visibility fns (like the active-scene resolver) | No columns | Contradicts ADR-0021; the transition matrix needs the before state of the cache; a reveal must still list every dependant |
| C. Edit scenes-map's token fn and scene-tools' fns directly, each reading a copy | No registry | Every later rule edits the fns again; two specs touch one fn (hotspot) |
| D. Client-side hiding | Trivial | Leaks to dev tools; rejected by the carried pick |

**Fog undo**

| Option | Pros | Cons |
|---|---|---|
| **A. Own per-scene LIFO stack of previous masks (≤ 20), persisted, `expectedEditId` guard, no redo** | Cheap (restore a mask); survives reload and crash; mirrors combat undo's guard | A second undo mechanism beside ADR-0016's compensating events |
| B. ADR-0016 compensating events | One mechanism | Needs inverse diffs per edit; ADR-0016 says scene edits are not undoable |
| C. No undo | Nothing to build | A slip spoils the next room; the brief asks for undo |

## Decision (proposed)

**A** and **undo A**:

- Each fog subject table gains `fogged` (bool), written only by the server: true iff every footprint cell is fogged. Written in the same transaction by fog commands and, through `derive`, by every command that writes a subject's scene, cell or size.
- `src/server/features/scenes-map/visibility-hooks.ts` (append-only, created by `fix/fog-core`, the first phase-2 core) exports `sceneVisibilityHooks: {name, derive?, hides?, dragToDm?}[]` (signatures: [fog-of-war §9](../../specs/fog-of-war.md#9-api--events)). `derive(read, obj)` only reads, so a signal audience may call it too. `hides(type, record)` reads only the record and returns the same answer for every player, so copies elsewhere (combat) stay one flag.
- Scene create / duplicate: fog registers a line in scene-tools' scene lifecycle registry `sceneHooks` (also created by `fix/fog-core`): create → fully fogged row; duplicate → copy of the source's fog row.
- `map.moveToken` order: scene-tools' `moveGuards` (may refuse) → `derive` + write in one transaction → token-changed hooks.
- scenes-map's token fn returns `hidden` when `hidden` or any `hides` is true; scene-tools' fns (props, templates) do the same. `map.drag` routes `"dm"` when any `dragToDm` is true; scene-tools' `scn.template` signal routes `"dm"` when a DM-placed template's cells are wholly fogged. Walls and doors are not fog subjects.
- scenes-map exports `tokenHiddenForPlayers(token)`; combat copies use it instead of `hidden` (subject to OQ-FOG-07). Fog commands run the token-changed hooks for tokens whose fog-hidden value flips.
- Fog undo is a per-scene stack, separate from ADR-0016 undo; ADR-0016's "not scene edits" gains the exception "fog edits (own stack)".

## Consequences

- Shared changes: schema (`token.fogged`, fog tables; SCN creates its tables with `fogged` in `fix/scn-core`, after `fix/fog-core`), scenes-map's token write paths, `tokenVisibility`, `drag.ts`, scene create / duplicate; AGENTS §9.9 append-only list gains `visibility-hooks.ts`, `sceneHooks` (with scene-tools' `moveGuards`, `canvasTools`).
- Fog undo (server stack) and scene-tools undo (client-side inverse intents) differ by design: one mask vs many records.
- ADR-0028 / 0031: token-changed hooks also run inside fog commands (per flipped token). ADR-0033: the `map.drag` audience consults the registry.
- Combat: hidden copies follow fog (combat-tracker FR-CBT-08 / -09, combat-extras FR-CBTX-13 / -45 amended) if OQ-FOG-07 picks it.
- Protocol: new record type `fog` (scope `scene`); token wire gains `fogged` (only when true); CON-44 budget row.
- Glossary: **Undo** and **Fog** reworded (OQ-FOG-16).
- No hook registered → no behaviour change; scenes without a fog row are clear.
