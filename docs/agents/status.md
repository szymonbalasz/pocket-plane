# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3. Scenes building; Combat specs in revision after the DM gate (#134–#140).

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …` ([prompt §3](orchestrator-prompt.md#3-herdr)). Clean up worktrees after merge. Test agents get a dedicated server pane (AGENTS §9.6). Max 4 working agents.

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| build play-shell | — (ended) | merged (`92c985f`) | walkthrough 11/11 | — |
| build assets-pipeline | `build-assets-pipeline` (`wZ:p2`), `test-assets` (`wZ:p3`, server `wZ:p4`, port 4123) | `wZ`, `build/assets-pipeline`, slot 2 | all slices done; walkthrough A running | — |
| build entities | — | — | queued | assets-pipeline merge |
| build scenes-map | — | — | queued | entities; + ADR-0028 token-changed hook registry (#134) |
| Revise combat-tracker | `rev-combat-tracker` (`w0:p2`) | `w0`, `spec/combat-tracker` | revising | — |
| Revise dice-roll-log | `rev-dice-roll-log` (`w11:p2`) | `w11`, `spec/dice-roll-log` | revising | — |
| Revise notifications | `rev-notifications` (`w12:p2`) | `w12`, `spec/notifications` | revising | — |
| Revise character-sheet | — | — | queued | agent slot |
| Consolidate Combat (data model + protocol) | — | — | queued | 4 revisions merged; DM sets `complete` |

Walkthrough evidence archived outside the repo: `%TEMP%\opencode\verify-{skeleton,scenes-core,play-shell}\`.

## Shared-file locks (AGENTS §9.9, sequenced)

- `build/assets-pipeline`: `src/server/db/schema.ts`, `src/shared/events/` (+ index), `src/server/http.ts` (dmCampaign, CON-21), `src/server/services.ts` + `server.ts` (onStart), fixtures loader (async steps), `fixtures/bundles/session-sim.ts`, data-model §10/13, protocol §13/14/18/19.

## Pending DM decisions

- None. Combat gate decided (#134–#139); gems tier A (#140).

## Resolved locally (report at gate)

- `fix/scenes-core`: owner assigned `src/server/services.ts`; reconnect HTTP probe (#133).
- ADR-0029 amended by the integrator (cut floor before filter, `pin`), accepted with B8 (#137).
- assets-pipeline: REST errors keep code `invalid` with HTTP 413/415/422; FR-ASSET-16 re-arm on record change deferred to scenes-map; test-mode "Images" launcher.
- play-shell: toast z-index above dialogs left as is (cosmetic).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — campaign-management behaviour, observed by test agent; check against spec at the Scenes gate.
