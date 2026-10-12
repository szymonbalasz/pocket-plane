# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3. **Scenes built** (demo: [demo-scenes](demo-scenes.md)); Combat building. DM asked for long autonomous stretches (#141): report only when blocked.

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …`. Clean up worktrees after merge. Test agents get a dedicated server pane (AGENTS §9.6). Max 4 working agents.

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| Scenes: play-shell, assets-pipeline, entities, scenes-map | — (ended) | merged | walkthroughs 11/11, 7/7 + B 4/4, 6/6, 8/8 | — |
| Combat core: `fix/combat-core`, notifications, dice-roll-log | — (ended) | merged | e2e green; walkthroughs 16/16, 10/10 | — |
| `fix/client-polish` (reconnect probe 204, lazy Konva) | `build-polish` (`w1B:p2`) | `w1B`, slot 0 | finishing (protocol §6 row, constant) | — |
| build character-sheet | `build-character-sheet` (`w1C:p2`) | `w1C`, slot 2 | building | — |
| build combat-tracker | `build-combat-tracker` (`w1D:p2`) | `w1D`, slot 3 | building non-PC slices | character-sheet merge (adjustHp, roll routes) |
| Spec party-loot (Phase 4) | — | draft on `main`; review `%TEMP%\opencode\review-loot.md` | in-review | DM: OQ-LOOT-01/02/06 |

Evidence archived: `%TEMP%\opencode\verify-{skeleton,scenes-core,play-shell,assets,entities,scenes-map,notifications,dice}\`.

## Shared-file locks (AGENTS §9.9, sequenced)

- `fix/client-polish`: `src/client/common/sync/`, `/ws` probe route, `vite.config.ts`, `src/shared/protocol/frames.ts`, protocol §3.1/§6, MapCanvas import lines in DmMap/PlayerMap.
- character-sheet / combat-tracker: ask before any shared file.

## Pending DM decisions (next check-in, not blocking)

- party-loot: OQ-LOOT-01 entry shape (pick: free text + optional coin columns), OQ-LOOT-02 corrections (pick: void, struck through), OQ-LOOT-06 notification (pick: info toast to all + history).
- Scenes gate demo ready: [demo-scenes](demo-scenes.md).

## Resolved locally (report at gate)

- OQ-NOTE-13 badge; CON-44 DM snapshot 768 KB; Combat specs `complete` (#142).
- Shell window tests are registry-driven (overlap only within default-open product windows, and within test windows).
- Loader-test EBUSY flake: retry + swallow on teardown (cherry-picked to `main`).
- notifications §13 step 9 expected count corrected to 2.
- e2e specs choose their bundle via `// e2e-bundle: <name>` header (combat-core).
- assets: REST errors keep code `invalid` + 413/415/422; play-shell: toast z-index left as is.
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management.
