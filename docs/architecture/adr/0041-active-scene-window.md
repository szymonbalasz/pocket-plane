# 0041 — Active-scene window for tokens and scene-tool records in the DM snapshot

- Status: accepted (2026-10-15; decisions-log #196)
- Date: 2026-10-15
- Refines: [ADR-0021](0021-sync-protocol-conventions.md) C ("DM: whole campaign"); sibling of [ADR-0029](0029-windowed-record-types.md)
- Affects:
  - [live-sync](../../specs/live-sync.md) (FR-SYNC-09, FR-SYNC-20)
  - [scenes-map](../../specs/scenes-map.md) (`token`, FR-MAP-08, FR-MAP-44)
  - [scene-tools](../../specs/scene-tools.md) (FR-SCN-32)
  - [combat-tracker](../../specs/combat-tracker.md), [combat-extras](../../specs/combat-extras.md) (DM dialogs that read tokens)
  - [protocol](../../protocol/README.md) §3.4, §4, §5, CON-44
- Raised by: [OQ-SCN-01](../../specs/scene-tools.md#15-open-questions) (= OQ-FOG-04), [OQ-SCN-18](../../specs/scene-tools.md#15-open-questions); phase-2 review X1, B5, B11

## Context

- The heavy DM snapshot is 781,916 B (measured) of the 786,432 B ceiling (CON-44).
- Fog adds rows and `fogged` copies; a typical prepped scene-tools scene adds ≈ 7.3 KB.
- **Tokens:** 300 rows = 148,153 B. 240 of them sit on non-active scenes: ≈ 121,125 B with fog's `fogged` (measured, phase-2 CON-44 table). Base with fog + one SCN scene: 797,382 B, 10,950 B over.
- 30 prepped scenes of SCN records would add ≈ 216 KB.
- The DM sees one scene at a time (viewed scene, #122). Every other scene's tokens and map content are dead weight in the snapshot.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. A registration flag `dmWindow: "active-scene"` (scene scope only) on `token`, `scene-structure`, `scene-prop`, `aoe-template`. The DM snapshot holds only the active scene's rows; the DM client loads another scene's rows with the WS intent `sync.loadScene {sceneId}`, answered in hub frame order** | Heavy DM 676,257 B, 110,175 B left (measured) + all SCN prep off the frame; the cost stays one scene however much is prepped; no MOD change | One load per viewed scene per snapshot; convergence changes for flagged types; DM dialogs that read another scene's tokens load it first |
| B. Every scene in the DM snapshot; effect presets on demand instead | No sync change | 7,512 B left (measured); reopens #190 OQ-MOD-14 / -15; SCN prep still grows the frame |
| C. Raise the DM ceiling | No code | DM decision; the frame grows with prep; join time over a tunnel |

## Decision

**A** (#196, DM gate 2; OQ-SCN-01 = OQ-FOG-04 option B).

## Consequences

| Topic | Rule |
|---|---|
| Snapshot | DM: flagged types → the active scene's rows only (none if no scene is active); every other type unchanged. Players unchanged (the scene gate already limits them to the active scene). Fog rows are **not** flagged (compact; FOG §12) |
| Load | `sync.loadScene {sceneId}`: DM only, read-only. Result `ack {records {<type>: Record[]}}`: every flagged type's rows for that scene, through the scope gate and the visibility fn as in a snapshot. Handled in the hub's frame order, so events committed before the read are already in it, later ones follow as events: nothing lost or duplicated (as FR-SYNC-10). Unknown or other-campaign scene → `not_found` |
| Live events | Unchanged: flagged rows of every scene still reach the DM as events. An upsert for an unloaded scene lands in the store; that scene still counts as unloaded, and its load replaces its rows |
| DM client | Keeps a `loadedScenes` set; after each snapshot it holds just the active scene. Viewing an unloaded scene (FR-MAP-08) sends the load; the canvas shows "Loading scene…" and FR-MAP-44's fit waits for it. One load in flight per scene; a reject → Toast + retry on the next view |
| Reconnect / resync | The snapshot resets `loadedScenes`; the client reloads the viewed scene if it isn't the active one |
| Scene switch | Activation resyncs players only (FR-MAP-06). The DM is usually viewing the new active scene (so it is loaded); if not, its next view or snapshot covers it. A deleted scene's rows arrive as deletes (scene hooks) |
| Convergence (FR-SYNC-20) | For flagged types, the DM store is compared on the active scene + loaded scenes only; players are unchanged. Helpers in `src/server/ws/testing/convergence.ts` take the loaded set |
| Leak scan | Also scans `ack.records` (B11). DM only, but the helper stays uniform |
| Initiative and combat | Initiative rows read the combatant's own copies (ADR-0028), never the token, so they are unaffected. DM dialogs that read tokens of a given scene load it first (`useSceneLoaded(sceneId)`): the mid-fight Add dialog reads `enc.sceneId`'s tokens (FR-CBTX-44); Start and the encounter builder read the viewed scene's (loaded by viewing, FR-CBT-66); the attack popup's link hint reads the selection (viewed scene). Server-side combat reads the DB and is unaffected |
| Fixtures, digests | Unchanged: they read the DB, not a snapshot |
| CON-44 test | `snapshot-size.test.ts`: the heavy DM figure drops by the non-active tokens (re-baselined in the branch); a new assertion checks that the largest scene's load result (≤ 200 tokens + a max SCN scene ≈ 190 KB) stays under 512 KiB; `session-sim` DM drops the inactive scene's tokens (re-measured). Tests that expect every token in the DM snapshot (scenes-map `sync.test.ts`, combat setups) load the scene or assert the window |
| Build | Its own first branch, `fix/active-scene-window` (ws / snapshot lock), before `fix/fog-core` and `fix/scn-core`: registry flag, load intent, client loaded set, helpers, `token` flagged, combat dialog loads. `fix/scn-core` flags its own three types |
