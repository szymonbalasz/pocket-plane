# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3. Scenes building; Combat specs `complete` (#142); Combat core prep running; party-loot spec being written. DM asked for long autonomous stretches (#141): report only when blocked.

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …`. Clean up worktrees after merge. Test agents get a dedicated server pane (AGENTS §9.6). Max 4 working agents.

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| build play-shell, assets-pipeline | — (ended) | merged | walkthroughs 11/11, 7/7 | — |
| build entities | — (ended) | merged (`5c01b44`) | walkthrough 6/6, 250 tests | — |
| `fix/combat-core` | — (ended) | merged (`db2dd57`) | 279 tests, e2e 9/9 | — |
| Spec party-loot (Phase 4) | — (ended) | draft on `main`; review `%TEMP%\opencode\review-loot.md` | in-review | DM: OQ-LOOT-01/02/06 (batch at Scenes gate) |
| build scenes-map (+ FR-MAP-30 token hooks, token menu registry) | `build-scenes-map` (`w18:p2`) | `w18`, `build/scenes-map`, slot 0 | canvas UI; server slice next | — |
| build dice-roll-log | `build-dice-roll-log` (`w19:p2`) | `w19`, `build/dice-roll-log`, slot 2 | building | — |
| build notifications | `build-notifications` (`w1A:p2`) | `w1A`, `build/notifications`, slot 3 | building | — |
| build character-sheet → combat-tracker | — | — | queued | dice, notifications, scenes-map |

Evidence archived: `%TEMP%\opencode\verify-{skeleton,scenes-core,play-shell,assets}\`.

## Shared-file locks (AGENTS §9.9, sequenced)

- `build/scenes-map`: `src/server/db/schema.ts`, `src/shared/events/`, `fixtures/bundles/session-sim.ts`, `package.json`/`bun.lock` (konva), `src/client/common/features/assets-pipeline/image-cache.ts`, data-model, protocol.
- `build/notifications`: play-shell window type + launcher (`badge?(store)`).

## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Integrator: OQ-NOTE-13 add `badge?(store)`; CON-44 DM snapshot ceiling 768 KB (#142). Combat specs set `complete` after the DM's gate answers (#142).
- entities: hooks take `env {tx, ctx, actor}`; `imported-entity` audience dm; windows.test no-overlap only for default-open + test windows.
- assets-pipeline: REST errors keep code `invalid` with 413/415/422; FR-ASSET-16 re-arm deferred to scenes-map.
- play-shell: toast z-index above dialogs left as is.
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management at the Scenes gate.
