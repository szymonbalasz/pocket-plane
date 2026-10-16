# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 3 **Phase B (builds)** since 2026-10-16. Gate 1 passed (#207–#210); all five specs complete and merged; ADRs 0042–0046 accepted. Wave 1: V0 `fix/vision-core` ∥ D1 `build/dicex-tray`. Backlog only during downtime, not near the sprint's end ([orchestrator-prompt §3a](orchestrator-prompt.md#3a-use-idle-slots-backfill), [backlog](backlog.md)).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| V0 vision core | `fix/vision-core` (w3N, slot 0) | build-vision-core | Building | Review + regression walkthrough → merge; then V5, R0, `fix/lazy-records` |
| D1 dice tray | `build/dicex-tray` (w3M, slot 2) | build-dicex-tray | Building | Walkthrough D1 → merge; then D3, R2 |
| R early: formula + rule zod + presets | — | — | Merged (2d6d4c8) | R0 builds on it |
| C early: bundled SRD 5.1 + recorder + pure adapter | `fix/cmp-data` (w3Q, slot 4) | build-cmp-data | Building | Merge (no UI) → C1 wires it |
| Queue | — | — | V5 → V1 → (V4 ∥ V2) → V3; R0 → R1 ∥ R4 → R2 / R3 / R5–R7; `fix/lazy-records` → P core → P2 ∥ P3 → P4; C1 → C2 → C3, C4; D3, D2, D4 | Per locks below |
| Backlog (BL-nn), downtime only | `fix/bl-<nn>-<slug>` | — | BL-06 (#206), BL-02 (#211) merged | Per §3a |

## Shared-file locks

- `fix/vision-core`: `src/server/db/`, `src/server/ws/` + `src/shared/protocol/` + common sync store, `src/server/features/scenes-map/`, scene-tools shared parts, entities schemas.
- `build/dicex-tray`: `src/client/{dm,player}/windows.ts` (append), `PlayFrame.tsx` (one mount line), `src/client/common/features/dice-roll-log/`.
- Order after: schema V0 → R0 → P core → C1 → D2; ws V0 → `fix/lazy-records`; canvas V1 → V4 → V3; sheet V5 → R3 → R6 → C2 → D4 → P4 / C4; combat R0 → R7 → C2; dice-roll-log client D1 → R2.

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
