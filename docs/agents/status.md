# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 2 **phase 1 complete** (#194; playtest section in sprint-2). Phase 2 specs running (F fog-of-war, B scene-tools); `fix/sim5-glitches` in parallel. Next: F/B seam, one review, DM gate 2 (incl. CON-44 headroom and session-sim-5 glitches).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Phase 1 (Q, P2a, P2b, M tier 1) | merged | — | Done (#189-#194), session-sim-5 13/13 | DM playtest |
| sim-5 bugs (stale popup targets, created tokens without art) | `fix/sim5-glitches` (w20, slot 0) | fix-sim5-glitches | Building | Walkthrough |
| F: fog of war | `spec/fog-of-war` (w2Y) | spec-fog-of-war | Spec | Seam, review, gate 2 |
| B: props + structure | `spec/scene-tools` (w2Z) | spec-scene-tools | Spec | Seam, review, gate 2 |

## Shared-file locks

- Combat-tracker DM client (targets / popup), combat-extras add / scenes-map placeTokenIn: fix/sim5-glitches.
- Schema: free (phase 2 cores later, one at a time).

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
