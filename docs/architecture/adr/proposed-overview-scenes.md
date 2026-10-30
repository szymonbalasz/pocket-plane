# Proposed — Overview scenes: a second kind of scene on its own tables and canvas

- Status: proposed. Raised by `spec/overview-scenes`; the DM picked the approach on 2026-10-30, acceptance is at spec review
- Date: 2026-10-30
- Refines: [ADR-0041](0041-active-scene-window.md) (the DM's scene window also covers overviews), [ADR-0039](0039-fog-visibility.md) (`sceneHooks` gains a member)
- Consistent with: [ADR-0016](0016-domain-events-pending-actions.md) (one command, one transaction, one event), [ADR-0021](0021-sync-protocol-conventions.md) (no optimistic intents), [ADR-0023](0023-asset-access-by-capability-id.md) (asset IDs reach a player only on a visible record), [ADR-0026](0026-signal-routing.md) (signals)
- Affects: [overview-scenes](../../specs/overview-scenes.md), [scenes-map](../../specs/scenes-map.md), [combat-tracker](../../specs/combat-tracker.md), [entities](../../specs/entities.md), [assets-pipeline](../../specs/assets-pipeline.md); protocol, data model, glossary and AGENTS §9.9 at merge

## Context

- About half the DM's table time is on **zoomed-out maps**: the Sword Coast, Phandalin, Neverwinter. Miniatures, place names with a dot, and images such as a quest scroll sit on or beside the map. No fight happens there.
- A battle scene can fake this today (grid hidden, fog cleared), but the grid is not just a look. It is how the app positions things:
  - Tokens and props sit on whole cells (`col`, `row`), and a token's size comes from the cell.
  - Every scene must have one map (`Scene.mapAssetId` is required), and tokens and props must overlap it.
  - About 50 source files read a scene's map or grid fields; about 70 use cell positions, including fog and combat.
  - Every new scene gets a fully fogged row from fog's `created` hook.
- The DM's decision: two kinds of scene. Battle scenes stay as they are. The other kind holds images, place labels and miniatures, placed anywhere.
- What the code gives us:
  - The record registry's scene gate only compares IDs: a player gets a scene-scoped record iff its `sceneOf` equals the campaign's active ID, and `null` hides them all (`RecordRegistry.view`).
  - Everything that calls that resolver only compares IDs (`hub`, `drag.ts`, `templates.ts`). The server's other "active scene" read, `activeSceneOf(tx, cid)`, queries the `scene` table directly.
  - `map.activateScene` only ever swaps one scene for another. No command leaves a campaign with no active scene once one is shown, and an active scene can't be deleted ([FR-MAP-05](../../specs/scenes-map.md#6-functional-requirements)).
  - `cbt.start` takes the DM's **viewed** scene, not the active one, and the server checks only that it is a scene of the campaign.

## Decision 1 — Where an overview lives

| Option | Pros | Cons |
|---|---|---|
| **A. New tables `overview` and `overview_item`** | Battle code and data stay as they are; adding tables can't touch existing campaign data; fog, walls and combat never see an overview | Scene-list commands are written again (small); the Scenes window merges two lists; "one thing shown" spans two tables |
| B. `Scene.kind` + nullable map | Scene list, Show and folders for free | `mapAssetId` nullable through about 50 files; every fog, token, prop and template path needs a guard; a missed guard breaks a battle map |
| C. Free positions for tokens and props everywhere | One model for both kinds | Rewrites about 70 files including fog vision and combat; the highest risk to battle maps, with no gain for them |

**A.**

## Decision 2 — How players get an overview

| Option | Pros | Cons |
|---|---|---|
| **A. Reuse the scene gate: `overview` and `overview_item` are `scope: "scene"` with `sceneOf` = the overview's ID, and the active-scene resolver returns the shown overview's ID when one is shown** | One visibility path, so the transition matrix, resync, DM window (`dmWindow: "active-scene"`), `sync.loadScene` and reconnect all work as they do; a player's scene rows leave at once because their `sceneOf` no longer matches | "Active scene" in the sync layer now means "the shown thing": a naming debt, documented on the resolver |
| B. `scope: "campaign"` with a visibility function and a second cache | The resolver keeps its meaning | A second gate to keep leak-free; the DM window and load path would be rebuilt (lazy types exclude `dmWindow`) |

**A.** Rules:

- `ActiveSceneCache.load` reads the active scene, else the shown overview; it refreshes on `SceneActivated` and `OverviewShown`. Its callers keep comparing IDs.
- `activeSceneOf(tx, cid)` stays battle-only and returns null while an overview is shown, so roll guards, templates and pets see "no battle scene".
- The `provideSceneCampaign` resolver answers for overview IDs too, so `sync.loadScene` works unchanged.
- Overview IDs and scene IDs come from one generator and never collide.

## Decision 3 — Showing an overview takes the battle scene off

- **`ovw.show`** in one transaction: active scene off (if any), previous overview off (if any), target on; `sceneHooks.deactivated` runs for the scene that went off; event `OverviewShown`. Players resync as for `SceneActivated`.
- **New `sceneHooks` member `deactivated(env, scene)`**, not append-only (same class of change as `mapChanged`): `map.activateScene`'s `activated` hooks assume a scene came on. First line: entities re-derive `petPresent` with no scene active.
- **`map.activateScene` turns a shown overview off** through an `activated` line of the overview feature, one append to `sceneHooks`. The command itself doesn't change.
- A shown overview can't be deleted (`conflict`), as a shown scene can't.
- **Fights:** a running encounter continues when an overview is shown, as it does on a scene switch today. The DM client disables Start while an overview is viewed; a forged `cbt.start` with an overview ID fails `getScene` (`not_found`). No combat code changes.

## Decision 4 — A new canvas

| Option | Pros | Cons |
|---|---|---|
| **A. New `OverviewCanvas` (react-konva), lazily loaded like the map canvas** | No branching in `MapCanvas` (1,333 lines, built around the grid and tokens); reuses camera helpers, ping, laser, pull, the asset picker and the window system | Pan, zoom and selection wiring written a second time, smaller |
| B. Branch inside `MapCanvas` | One canvas | Every tool, layer and fit gets an "is overview" branch, and overview bugs can reach battle maps |

**A.** Ping, laser and pull reuse their signals with the overview's ID as `sceneId`: the hub forwards them without a scene check and each receiver compares IDs. Item dragging gets its own signal `ovw.drag`, because `map.drag`'s audience hook reads the token table.

## Decision 5 — One item record

- One table and one record type with `kind` ∈ `image` · `label` · `miniature`: shared position, size, stack, hidden and locked, so selection, group move and hide are written once.
- Items draw in three bands, images < labels < miniatures, so a map placed later can't cover the party.
- A miniature is **not** a token: no creature behind it, no vision, HP, conditions or initiative. A party miniature links to its character only for display (name, art, owner).

## Consequences

- **Schema:** two new tables; no change to existing tables. `drizzle-kit push` adds them.
- **Shared files** (AGENTS §9.9), all in the core slice: `src/server/db/`, `src/shared/events/`, `active-scene.ts`, `scene-hooks.ts` (new member), `scenes-map/index.ts` (resolver), `src/shared/assets-pipeline/manage.ts` (use kind), folder delete (also moves overviews to the root).
- **DM client:** the viewed-scene resolver returns null while an overview is viewed, so battle tools and Start switch off through one seam (`view-state.ts`).
- **Unchanged:** battle-scene records, tokens, props, fog, templates, combat rules, `MapCanvas`.
- **Not solved:** images stay capped at 4096 px on the long edge ([FR-ASSET-05](../../specs/assets-pipeline.md#6-functional-requirements)), so a large regional map goes soft at high zoom.
- **Risk:** "nothing shown as a battle scene" has until now been the state of a new campaign, not of a session in progress. The core slice tests a running fight, pets and rolls in that state first; a failure there stops the build.
