# NNNN — Active-scene window for heavy scene records in the DM snapshot

- Status: proposed
- Date: 2026-10-15
- Refines: [ADR-0021](0021-sync-protocol-conventions.md) C ("DM: whole campaign"); sibling of [ADR-0029](0029-windowed-record-types.md)
- Affects: [live-sync](../../specs/live-sync.md) (FR-SYNC-09, FR-SYNC-20), [scene-tools](../../specs/scene-tools.md) (FR-SCN-32), fog-of-war, optionally [scenes-map](../../specs/scenes-map.md) (`token`), [protocol](../../protocol/README.md) §3.4, §4, §5, CON-44
- Raised by: [OQ-SCN-01](../../specs/scene-tools.md#15-open-questions), [OQ-SCN-18](../../specs/scene-tools.md#15-open-questions)

## Context

- The heavy DM snapshot is 781,923 B of the 786,432 B ceiling (CON-44) after sprint 2 phase 1. A typical prepped scene adds ≈ 7.3 KB of walls, props and templates; 30 prepped scenes ≈ 216 KB. Fog geometry adds more per scene.
- The DM sees one scene at a time (viewed scene, #122). Every other scene's map content is dead weight in the snapshot.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Registration flag `dmWindow: "active-scene"` (scene scope only): the DM snapshot holds only the active scene's rows; the DM client loads another scene's rows with intent `sync.loadScene {sceneId}` → `ack {records}` when it views it** | Snapshot cost = one scene, however many are prepped; generic (SCN, FOG, later `token`) | One load per viewed scene per snapshot; convergence rule changes for flagged types |
| B. Every scene in the DM snapshot, compact encodings only | No protocol change | Still ≈ 216 KB for SCN alone at 30 scenes |
| C. Raise the DM ceiling | No code | DM decision; frame grows with prep; join time over a tunnel |

## Decision

> Undecided. Suggested: **A** (DM gate 2 with OQ-SCN-01).

## Consequences

- `sync.loadScene` is DM-only, read-only, answered in the hub's frame order (events committed before the read are in it; later ones follow as events), so nothing is lost or duplicated (as FR-SYNC-10). Result rows pass the scope gate and the visibility fn like a snapshot.
- Live events for flagged types still reach the DM for every scene. The DM client keeps a `loadedScenes` set (the active scene after each snapshot); viewing an unloaded scene loads it; a snapshot or resync resets the set.
- **Convergence** (FR-SYNC-20): for flagged types, the DM's store is compared on the active scene and loaded scenes only; players are unchanged (scene gate).
- Activation needs no extra step: players resync (FR-MAP-06); the DM's next snapshot or a load covers the new active scene.
- scenes-map may flag `token` the same way later (≈ 114 KB off the heavy DM frame), with its own spec change.
