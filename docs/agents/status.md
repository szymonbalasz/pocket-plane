# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 3 **Phase B (builds)** since 2026-10-16. Gate 1 passed (#207–#210); all five specs complete and merged; ADRs 0042–0046 accepted. Wave 1: V0 `fix/vision-core` ∥ D1 `build/dicex-tray`. Backlog only during downtime, not near the sprint's end ([orchestrator-prompt §3a](orchestrator-prompt.md#3a-use-idle-slots-backfill), [backlog](backlog.md)).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| V2 vision server + Invisible | `build/vision-server` (w4B) | build-vision-server | Building | Walkthrough → V3 |
| V4 freeform walls + red hint | `build/walls-freeform` (w4C) | build-walls-freeform | Building | Walkthrough SCN S1–S4 |
| R2 tier 2 client | `fix/mod-roll-preview` (w4D) | build-mod-roll-preview | Building | Walkthrough |
| R3 tier 3 uses | `build/mod-tier3` (w4A) | build-mod-tier3 | Building | Walkthrough → R6 |
| P core | `build/party-core` (w30) | — | Ready (walkthrough comes with P2); merging after R4 | C1, P2 ∥ P3 |
| Merged so far | — | — | D1 (#214), D3 (#217), V0 (#216), V5 (#219), lazy-records (#218), R0 (#220), R1 (#222), V1 + empty-event fix + R4 (#223); early slices rt-shared, cmp-data (#213), party-shared; BL-06, BL-02, BL-11 | — |
| Queue | — | — | V3 (after V2 + V4, canvas 3rd); R5 → R6 (sheet) → R7 (combat); C1 (after P core) → C2 → C3, C4; P2 ∥ P3 → P4; D2 (after C1), D4 (sheet, after C2) | Locks below |
| Backlog (BL-nn), downtime only | `fix/bl-<nn>-<slug>` | — | BL-06, BL-02, BL-11 done; open BL-01, 03–05, 07, 08, 10, 12–14 | Per §3a |

## Shared-file locks

- `build/vision-server` (V2): scenes-map registry lines, entities definition hook line, player-hooks line, combat `join.ts` (Start / Add dependants), bundles index.
- `build/walls-freeform` (V4): canvas lock 2nd (then V3).
- `fix/mod-roll-preview` (R2): dice-roll-log client folder, dice-extras tray-extras line, DM popup files (not with R7), roll-intent `manualParts` pass-through.
- `build/mod-tier3` (R3): character-sheet folder (sheet lock 2nd; `resources.ts`).
- Next: schema P core → C1 → D2; canvas V4 → V3; sheet R3 → R6 → C2 → D4 → P4 / C4; combat R7 → C2.
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
