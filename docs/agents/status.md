# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 2 phase 1 complete (#194, #195; DM playtest pending). Phase 2 specs F (fog-of-war) + B (scene-tools) written, seams settled, reviewed (2 blockers + 12 major, applied; CON-44 measured). **Waiting: DM gate 2** (`%TEMP%/pocket-plane/gate-sprint2-phase2.md`).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Phase 1 | merged | — | Done (#189-#195) | DM playtest |
| F: fog of war | `spec/fog-of-war` (w2Y) | spec-fog-of-war | Reviewed, in-review | Gate 2, merge, builds |
| B: scene tools | `spec/scene-tools` (w2Z) | spec-scene-tools | Reviewed, in-review | Gate 2, merge, builds |

## Shared-file locks

- None (no build branch active).

## Pending DM decisions

- Gate 2: E1 CON-44 (pick B token + SCN active-scene window, measured 110 KB free), E2-E8 fog / scene-tools picks, E9 three ADRs, E10 session-sim-5 glitches as a P3 track.

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
