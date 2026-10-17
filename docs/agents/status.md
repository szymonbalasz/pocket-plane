# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** **Sprint 4 Phase B (builds)**. DM gate 1 "go" (#245, #246). All five spec branches merged; ADRs 0047–0050 numbered; C's cross-spec text applied; spec index updated. Docs pass merged.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Specs V, D, M, R, C | merged (#245) | — | Done | — |
| Docs pass | merged bd07224 | — | Done | — |
| C-search | `build/cmp-search` (w59, slot 3) | build-cmp-search | Building | Walkthrough |
| V6 vision core | `fix/vision-s4-core` (w54, slot 0) | build-vision-core | Building | Walkthrough |
| D5 die shapes + log dice | `build/dice-shapes` (w55, slot 2) | test-dice-shapes | Walkthrough (check 2917, e2e 83 green) | Merge; D6 adds the throw-dice sum flag (D5 open issue) |
| M0 area helper | merged 7c5d3cf | — | Done (check 2888 green) | V9 brush imports it |
| M4 window placement | `fix/window-placement` (w57, slot 4) | build-window-placement | Building | Walkthrough |

## Shared-file locks

- `fix/vision-s4-core` (V6): schema, `src/server/ws/` + protocol, entities `senses`, sheet folder (Senses), scene-hooks `mapChanged`, Open5e adapter line, bundles index + `fog.ts`.
- `build/dice-shapes` (D5): bundles index (append).
- `fix/window-placement` (M4): play-shell frame + `toast-region.ts`, windows.ts handout line, combat Initiative open lines.
- Order: schema V6 → R0 → Mc → C-art core; canvas V7 → V8 → M2 → M5 → C-art; sheet V6 → R weapon rows → R negative uses; toast region M4 → D7; log D5 → R Fury line; creature form R weapon rows → C-art.
- Protocol / data-model section numbers: assigned at merge (parallel branches collide; `resolve_docs.py` in the scratch dir renumbers the later one).

## Pending DM decisions

- None.

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
