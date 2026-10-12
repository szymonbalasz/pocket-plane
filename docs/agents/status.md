# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 2 — Skeleton build (slice 6/7: clients); Scenes specs revised, waiting on DM `complete`

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …` ([prompt §3](orchestrator-prompt.md#3-herdr)). Clean up worktrees after merge.

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| Skeleton build | build-skeleton (`w17:p2`) | `w17` / `build/skeleton` | slices 1–5 committed; 6 (clients) in progress | — |
| Specs assets-pipeline, entities, play-shell, scenes-map | — (ended) | revision 2 on `main` | in-review, 0 blocking OQs | DM: complete + accept 4 ADRs |

Next on DM "go": number ADRs 0023–0026 → specs `complete` → `review-consolidate` for Scenes (data model, protocol, glossary, FIX §8 fixtures, AGENTS §9.9 registries, ADR-0014 note) → after skeleton merges and DM runs it: `fix/signal-routing`, then Scenes builders (play-shell first).

## Pending integrator notes for the skeleton builder (next stop)

- Player REST credential: moot after #123 (no player REST credential for images).

## Risks

- Scenes build order: skeleton → signal-routing change (live-sync shared files) → play-shell (window registry) → assets / entities → scenes-map.

## Resolved locally (report at gate)

- Token display name is instance state, never refreshed by definition edits; image + size refresh via an in-transaction hook.
- OQ-SHELL-07 / OQ-ENT-14: window registry, definition-changed hooks and creatureActions registries become append-only registries (AGENTS §9.9) — applied at consolidation.
