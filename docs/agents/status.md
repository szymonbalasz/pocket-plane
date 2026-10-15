# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 2 phase 1 builds (#190 gate 1 'go with picks'; specs merged, ADR-0037 / 0038). Wave 1 = four P2b branches; P2a core waits for map-fit-floor; M last. Plan: phase-1 review build graph (`.verify/review-phase1/review.md` "Build order").

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| G2 / G3 map fit | `fix/map-fit-floor` (w2J, slot 0) | build-map-fit-floor | Building | Walkthrough scenes-map 12, 13 |
| G6 + FR-DICE-34 | `fix/physical-crit` (w2K, slot 2) | build-physical-crit | Building | Walkthrough dice 13, 14 |
| N4 / N7 sheet / item 16 | `fix/charx-buttons` (w2M, slot 3) | build-charx-buttons | Building | Walkthrough CHARX |
| N1 + growToContent | `fix/shell-minimise` (w2N, slot 4) | build-shell-minimise | Building | Walkthrough shell 17, 18 |
| P2a core (schema, scenes-map seams, token characterId) | `fix/combat2-core` | — | After map-fit-floor | — |
| P2a add (N5, N6, 15, 17) | `fix/combat2-add` | — | After core | — |
| P2a polish (N8, N11, G1, G4, G5, G7, G9, G10) | `fix/combat2-polish` | — | After core + shell-minimise | — |
| P2a split attack (N7 combat) | `fix/combat2-split-attack` | — | After polish, charx-buttons, physical-crit | — |
| P2b cues (G8, 13, N3) | `fix/charx-cues` | — | After charx-buttons | — |
| M tier 1 | `fix/mod-core`, `build/effect-modifiers` | — | After combat2-add + physical-crit; slices 3-4 last | — |
| F: fog of war (phase 2) | `spec/fog-of-war` | — | After phase 1 | — |
| B: props + structure (phase 2) | `spec/scene-tools` | — | After phase 1 | — |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-14-evening)). Briefs in `briefs\`. Evidence: `verify-*\` (session-sim-3 evidence only in the main checkout: `.verify/20261014-131140-session-sim-3/`; the `%TEMP%` copy was cleared).

## Shared-file locks

- Canvas (scenes-map camera / MapCanvas): fix/map-fit-floor → fix/combat2-core → phase 2.
- Play-shell frame: fix/shell-minimise.
- `src/shared/events/character-sheet.ts` + character-sheet folder: fix/charx-buttons → fix/charx-cues → M.
- Roll control / dice-roll-log: fix/physical-crit → combat2-split-attack → M.
- Schema: fix/combat2-core → fix/mod-core.

## Pending DM decisions

- None. Gate 1 answered (#190).

## Resolved locally (report at gate)

- Sprint 2 phase 1 seams S1–S7 + review rulings: `.verify/review-phase1/{seams,rulings}.md` (main checkout). N7 kinds: `toHit` / `spellToHit` new, `attack` keeps Attack + damage. Token gets a `characterId` display copy (ADR-0021/0024-safe) for FR-CBTX-50. Build plan = the reviewer's graph (`review.md` "Build order").

- Sprint 1: CON-44 headroom is tight (heavy DM snapshot 746 KB vs 768 KiB after cbtx-core). D build: snapshot only active effects; never raise a ceiling without a look.
- Sprint 1 nit (not a FAIL): Notifications window opens ~250 px tall vs spec §7 360×480 (test-polish-notes).

- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
