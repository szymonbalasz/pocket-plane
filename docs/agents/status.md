# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3. Scenes building; Combat specs in revision after the DM gate (#134–#140).

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …` ([prompt §3](orchestrator-prompt.md#3-herdr)). Clean up worktrees after merge. Test agents get a dedicated server pane (AGENTS §9.6). Max 4 working agents.

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| build play-shell | — (ended) | merged (`92c985f`) | walkthrough 11/11 | — |
| build assets-pipeline | — (ended) | merged (`83ca96c`) | walkthrough A 7/7, extras 10/11 (fixed: FR-ASSET-07 missing file) | — |
| build entities | `build-entities` (`w14:p2`) | `w14`, `build/entities`, slot 0 | building | — |
| build scenes-map | — | — | queued | entities; + ADR-0028 token-changed hook registry (#134) |
| Revise 4 Combat specs | — (ended) | merged to `main` | in-review | — |
| Consistency review (Combat) | — (ended) | `%TEMP%\opencode\review-combat-3.md` | done | — |
| Consolidate Combat (review-3 edits, data model, protocol, scenes-map ADR-0028 FR, AGENTS 9.3/9.9, glossary, FIX §8) | `consolidate-combat` (`w15:p2`) | `w15`, `spec/consolidate-combat` | working | DM: OQ-CBT-28, applied-card toast |

Walkthrough evidence archived outside the repo: `%TEMP%\opencode\verify-{skeleton,scenes-core,play-shell}\`.

## Shared-file locks (AGENTS §9.9, sequenced)

- `build/entities`: `src/server/db/schema.ts`, `src/shared/events/`, import pipeline core in `src/server/features/fixtures-adapters/`, data-model §3/11/13, protocol §12–17.

## Pending DM decisions

- None. Combat gate decided (#134–#139); gems tier A (#140).

## Resolved locally (report at gate)

- `fix/scenes-core`: owner assigned `src/server/services.ts`; reconnect HTTP probe (#133).
- ADR-0029 amended by the integrator (cut floor before filter, `pin`), accepted with B8 (#137).
- assets-pipeline: REST errors keep code `invalid` with HTTP 413/415/422; FR-ASSET-16 re-arm on record change deferred to scenes-map; test-mode "Images" launcher.
- play-shell: toast z-index above dialogs left as is (cosmetic).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — campaign-management behaviour, observed by test agent; check against spec at the Scenes gate.
