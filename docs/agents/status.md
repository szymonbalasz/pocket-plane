# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 2 phase 1 builds (#190 gate 1 'go with picks'; specs merged, ADR-0037 / 0038). Wave 1 merged (#192); wave 2 merged (#193); split-attack ∥ M slice 2, then M slices 3-4; then session-sim-5. Plan: phase-1 review build graph (`.verify/review-phase1/review.md` "Build order").

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Waves 1-2 (P2b all, P2a core / add / polish, M core) | merged | — | Done (#192, #193) | — |
| P2a split attack (N7 combat, item 12) | `fix/combat2-split-attack` (w2W, slot 2) | build-combat2-split-attack | Building | Walkthrough CBT 9c, 9d |
| M tier 1 slices 2-4 | `build/effect-modifiers` (w2V, slot 0) | build-effect-modifiers | Slice 2; slices 3-4 after split-attack merges | Walkthrough MOD §13 |
| Phase 1 close | main | — | After both | session-sim-5, "Playtest: phase 1 fixes" |
| F: fog of war (phase 2) | `spec/fog-of-war` | — | After phase 1 | — |
| B: props + structure (phase 2) | `spec/scene-tools` | — | After phase 1 | — |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-14-evening)). Briefs in `briefs\`. Evidence: `verify-*\` (session-sim-3 evidence only in the main checkout: `.verify/20261014-131140-session-sim-3/`; the `%TEMP%` copy was cleared).

## Shared-file locks

- Combat-tracker attack / damage / hp / card-kind / roll-route / popup / Initiative: fix/combat2-split-attack → M slice 3 (subject passing).
- Character-sheet `commands.ts`, CBTX concentration / play-state: M slice 3 (after split-attack).
- Schema: free (phase 2 cores next, one at a time).

## Pending DM decisions

- None now. Gate 2: CON-44 headroom (heavy DM 780,950 / 786,432 B after mod-core) before fog: presets on demand / fog compaction / raise ceiling.

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
