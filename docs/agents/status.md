# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3. Scenes building; **DM gate: Combat specs** ([gate-phase3-combat](gate-phase3-combat.md)).

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …` ([prompt §3](orchestrator-prompt.md#3-herdr)). Clean up worktrees after merge. Test agents get a dedicated server pane (AGENTS §9.6).

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| `fix/scenes-core` | — (ended) | merged (`bcdcfb5`, #133) | 116 tests; reconnect walkthroughs 10/10 + 6/6, max rejoin 1.2 s | — |
| build play-shell | `build-play-shell` (`wY:p2`), `test-play-shell` (`wY:p3`, server `wY:p4`) | `wY`, `build/play-shell`, slot 0 | 5 slices, 160 tests, e2e 6/6; §13 walkthrough running | — |
| build assets-pipeline | `build-assets-pipeline` (`wZ:p2`) | `wZ`, `build/assets-pipeline`, slot 2 | slices 1–4 done; window slice + e2e wait for play-shell merge | REST campaign middleware (CON-21) = shared change |
| build entities, scenes-map | — | — | queued | assets-pipeline; scenes-map also on DM B4/B5 |
| Combat specs (4 drafts on `main`, in-review) | — (ended) | reviews in `%TEMP%\opencode\review-combat-{1,2}.md` | DM gate | DM decisions B1–B8, P1–P28 |

Walkthrough evidence archived outside the repo: `%TEMP%\opencode\verify-skeleton\`, `%TEMP%\opencode\verify-scenes-core\`.

## Shared-file locks (AGENTS §9.9, sequenced)

- `build/assets-pipeline`: `src/server/db/schema.ts`, `src/shared/events/` (+ index), `src/server/http.ts` (dmCampaign, CON-21), `src/server/services.ts` + `server.ts` (onStart), fixtures loader (async steps), `fixtures/bundles/session-sim.ts`, data-model §10/13, protocol §13/14/19.
- `build/play-shell`: `src/client/{dm,player}/App.tsx`, `e2e/foundation.e2e.ts`, protocol §18. Creates window registries.

## Pending DM decisions

- Combat gate: [gate-phase3-combat](gate-phase3-combat.md) §1 (8 blocking), §2.1 (8 product picks), §2.2 (20 bulk-accept). B4/B5 decided (#134).

## Resolved locally (report at gate)

- `fix/scenes-core`: owner assigned `src/server/services.ts` (Registrar: signal, afterCommit, activeScene); scene-scoped test record type is tests-only.
- Reconnect: HTTP probe of `GET /ws` after a failed WS attempt (Chromium throttles WS failures) (#133).
- Draft specs merge to `main` at in-review so later Combat specs can read them.
- Integrator-only Combat items: gate doc §3 (I1–I31), applied in the revision pass after the DM gate.
