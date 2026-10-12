# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3. Scenes building; Combat specs `complete` (#142); Combat core prep running; party-loot spec being written. DM asked for long autonomous stretches (#141): report only when blocked.

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …`. Clean up worktrees after merge. Test agents get a dedicated server pane (AGENTS §9.6). Max 4 working agents.

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| build play-shell, assets-pipeline | — (ended) | merged | walkthroughs 11/11, 7/7 | — |
| build entities | — (ended) | merged (`5c01b44`) | walkthrough 6/6, 250 tests | — |
| `fix/combat-core` | `build-combat-core` (`w17:p2`) | `w17`, `fix/combat-core`, slot 2 | phase 1 done (ctx.dice, lint rule, ADR-0029 window); phase 2: tables, events, loader test, CON-34–43, per-spec e2e bundles | — |
| Spec party-loot (Phase 4) | — (ended) | draft on `main`; review `%TEMP%\opencode\review-loot.md` | in-review | DM: OQ-LOOT-01/02/06 (batch at Scenes gate) |
| build scenes-map (+ FR-MAP-30 token hooks, token menu registry) | `build-scenes-map` (`w18:p2`) | `w18`, `build/scenes-map`, slot 0 | non-schema slices first | schema/events lock after combat-core merges |
| build dice-roll-log, notifications | — | — | queued | combat-core |
| build character-sheet → combat-tracker | — | — | queued | dice, notifications, scenes-map |

Evidence archived: `%TEMP%\opencode\verify-{skeleton,scenes-core,play-shell,assets}\`.

## Shared-file locks (AGENTS §9.9, sequenced)

- (entities locks released at merge)
- `fix/combat-core`: `src/server/commands/`, `src/server/ws/`, `src/shared/protocol/`, `package.json`/`bun.lock`, `biome.json`, `scripts/e2e.ts` + `e2e/support/`, `src/server/db/schema.ts`, `src/shared/events/`, fixtures loader, data-model, protocol.

## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Integrator: OQ-NOTE-13 add `badge?(store)`; CON-44 DM snapshot ceiling 768 KB (#142). Combat specs set `complete` after the DM's gate answers (#142).
- entities: hooks take `env {tx, ctx, actor}`; `imported-entity` audience dm; windows.test no-overlap only for default-open + test windows.
- assets-pipeline: REST errors keep code `invalid` with 413/415/422; FR-ASSET-16 re-arm deferred to scenes-map.
- play-shell: toast z-index above dialogs left as is.
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management at the Scenes gate.
