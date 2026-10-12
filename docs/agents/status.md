# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3. Scenes building; Combat specs `complete` (#142); Combat core prep running; party-loot spec being written. DM asked for long autonomous stretches (#141): report only when blocked.

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …`. Clean up worktrees after merge. Test agents get a dedicated server pane (AGENTS §9.6). Max 4 working agents.

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| build play-shell, assets-pipeline | — (ended) | merged | walkthroughs 11/11, 7/7 | — |
| build entities | `build-entities` (`w14:p2`) | `w14`, `build/entities`, slot 0 | slices 1–3, e2e next | — |
| `fix/combat-core` | `build-combat-core` (`w17:p2`) | `w17`, `fix/combat-core`, slot 2 | phase 1 (ctx.dice, lint rule, ADR-0029 window) | phase 2 (tables, events, loader reseed, CON-34–43) after entities merges |
| Spec party-loot (Phase 4) | `spec-party-loot` (`w16:p2`) | `w16`, `spec/party-loot` | writing | — |
| build scenes-map (+ FR-MAP-30 token hooks, token menu registry) | — | — | queued | entities + combat-core merged |
| build dice-roll-log, notifications | — | — | queued | combat-core |
| build character-sheet → combat-tracker | — | — | queued | dice, notifications, scenes-map |

Evidence archived: `%TEMP%\opencode\verify-{skeleton,scenes-core,play-shell,assets}\`.

## Shared-file locks (AGENTS §9.9, sequenced)

- `build/entities`: `src/server/db/schema.ts`, `src/shared/events/`, import pipeline core + loader in `src/server/features/fixtures-adapters/`, `fixtures/bundles/session-sim.ts`, `src/client/dm/features/play-shell/windows.test.ts`, data-model §3/11/13, protocol §12–17.
- `fix/combat-core`: `src/server/commands/`, `src/server/ws/`, `src/shared/protocol/`, `package.json`/`bun.lock`, `biome.json`; schema/events/loader/docs only after entities merges.

## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Integrator: OQ-NOTE-13 add `badge?(store)`; CON-44 DM snapshot ceiling 768 KB (#142). Combat specs set `complete` after the DM's gate answers (#142).
- entities: hooks take `env {tx, ctx, actor}`; `imported-entity` audience dm; windows.test no-overlap only for default-open + test windows.
- assets-pipeline: REST errors keep code `invalid` with 413/415/422; FR-ASSET-16 re-arm deferred to scenes-map.
- play-shell: toast z-index above dialogs left as is.
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management at the Scenes gate.
