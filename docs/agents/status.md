# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 9 done (#338–#340); recap done, **sprint 10 planned (#341): hardening run, overnight, no gate unless blocking** ([sprint-10](sprint-10.md)). Briefs ready: `%TEMP%/pocket-plane/briefs/build-h{1,2,3,4}.md` (slice defs `h1`–`h4` in `slices.json`); inputs `.verify/sprint10/{seams,rulings-a,rulings-b,gate}.md`. All four builders started 2026-10-24 (sim-13 evidence copied into each worktree).

**Gates on `main`:** run in a detached worktree (`git worktree add --detach ~/.herdr/worktrees/pocket-plane/gates-main main`, then `bun install`, `bun run env:init`, `gates.sh <it> <tag>`), so `main`'s own `dist/` is never rebuilt while the DM tests there. Sprint 10: `~/.herdr/worktrees/pocket-plane/gates-main` (slot 5). Baseline `main` d4a5027e: check 5530 pass, e2e 225 passed.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Sprint 9 (RS0–3, PM1–2, FX1–3, SP1–3) | all merged | — | done | — |
| Sprint 10 H1 combat + dice | `fix/h1-combat-dice` (slot 0, ws wA6) | build-h1 | ready (check 5541, e2e green); small follow-ups | walkthrough (port 4103) |
| Sprint 10 H2 window frame + Party Manager | `fix/h2-frame` (slot 2, ws wA7) | build-h2 | building | walkthrough |
| Sprint 10 H3 toasts | `fix/h3-toasts` (slot 3, ws wA8) | build-h3 (idle), test-h3 | ready (3791c84e; check 5539, e2e 227) → walkthrough (port 4133) | merge |
| Sprint 10 H4 rules, recap, strongholds, misc | `fix/h4-rules-misc` (slot 4, ws wA9) | build-h4 | building | walkthrough |
| Sprint gate | main | — | session-sim-13 14 / 15 (`.verify/20261023-193558-session-sim-13/`); walkthrough evidence `.verify/sprint9/walkthroughs/` | — |

Backlog after sim-13: BL-97 (leak-like, first), BL-98–BL-104, BL-93, BL-94, BL-95, BL-96, BL-92.

## Shared-file locks

- H1: `fixtures/bundles/index.ts` (append), protocol / data-model rows; H2: play-shell frame + goldens + replay harness + scenes-map camera; H3: toast runtime; per [sprint-10 hotspots](sprint-10.md#boundaries-and-hotspots).

## Integrator rulings this sprint (tell the DM at the recap)

*(Sprint 10: add new rulings above the sprint-9 list.)*

Sprint 10:
- H1 BL-103: players' "Biggest overkill" amount was the hit's damage (allowed by FR-STATS-12), not a leak; players now read "N damage" on Session, recap Awards, Highlights and Trophies; DM unchanged (FR-STATS-12 amended).
- H1 BL-97: Add hidden hides a bound visible token like the map's hide; never unhides; Start keeps a bound token's own hidden flag (accepted as is).
- H1 BL-105: a player's own hidden-request answer follows their dice settings; the DM's own hidden rolls stay popup-only (FR-DICEX-84 amended).
- H1: granted the stale `DamageRolled` comment fix in `src/shared/events/combat-tracker.ts` (no other holder); one-line role pass in session-recap award views (H4's area; merge order sorts it).
- H3: "Saved …" toasts stay alerts in the one stack (FR-NOTE-50), placed like cards; new FR-NOTE-75 (content-aware spots), -76 (modal dialog as a keep-out).

- Toast stack: a window's title bar + first 40 px keeps the DM / player toast stack out (amends FR-NOTE-53; FX1 build, 2026-10-23), fallback FR-NOTE-71.
- Placer speed-up 3 (`roomFor`, exact) kept for the 25 ms bench gate (OQ-SHELL-84).
- Party Manager 550 px: 20 new player harness cells approved as named exemptions (BL-93).
- Launcher labels (SP2 re-test): with Rules added, the DM's launcher at 1280 shows icons only (threshold 1434 px); players keep full labels at 1280 (1044 px); per FR-SHELL-43 / #245.
- Walkthrough step wording fixed: live-sync FX3 step 4 (ellipsis only when the name doesn't fit), play-shell SP1 P3 / P8 (fixture pets).

## Pending DM decisions

- None (gate 1 passed, #335).

## Resolved locally (report at gate)

- Sprint 2 phase 1 seams S1–S7 + review rulings: `.verify/review-phase1/{seams,rulings}.md` (main checkout). N7 kinds: `toHit` / `spellToHit` new, `attack` keeps Attack + damage. Token gets a `characterId` display copy (ADR-0021/0024-safe) for FR-CBTX-50. Build plan = the reviewer's graph (`review.md` "Build order").

- Sprint 1: CON-44 headroom is tight (heavy DM snapshot 746 KB vs 768 KiB after cbtx-core). D build: snapshot only active effects; never raise a ceiling without a look.
- Sprint 1 nit (not a FAIL): Notifications window opens ~250 px tall vs spec §7 360×480 (test-polish-notes).

- Known flake: `e2e/combat2-polish.e2e.ts` FR-CBT-75 popup placement at 1440×900 / 1280×720 under parallel suites (sprint 5; 8 / 8 alone).
- Known flake: `e2e/weapon-rows.e2e.ts` "2d6+5 slashing" text check under a parallel full e2e (sprint 5; 3 / 3 alone).
- Known flake: `e2e/weapon-combat.e2e.ts` (Flame Tongue line count) under a loaded full run; passes alone.
- Known flake: `vision-s4.bench.test.ts` party move ≤ 30 ms fails only under parallel load (32 ms with 4 suites running; 11 ms alone). Re-run alone before treating it as real.
- Known flake: `placement.test.ts` FR-SHELL-46 inward column ≤ 5 ms under parallel load (37 ms on main after WF1; 3 / 3 alone) → BL-51.
- Known flake: `tooltip-titles.test.ts` FR-SHELL-30 scan times out (5 s) under parallel load; passes alone.
- Known flake: `dice-extras` e2e bundle (dice-extras / dice-screen) 1 / 4 runs under load: login never live, or the 3D chunk (Fit build, sprint 6).
- Known flake: `init-chips-effect.e2e.ts` Divine Fury hover tooltip under a loaded full run (3 / 3 alone; CP3 build).
- Known flake: `fog-of-war/leak.test.ts` walkthrough 8 "No frame within 1500 ms" under a parallel suite (main after BL-49, sprint 7; 3 / 3 alone).
- Known flake: `e2e/popup-line.e2e.ts` FR-DICEX-47 short screens (roll popups count) and `e2e/image-search.e2e.ts` token Image… menu under a loaded full run (sprint 7; pass alone).
- Known flake (sprint 9): `party-loot/sync.test.ts` FR-LOOT-03 "No frame within 1000 ms" under a full check (3 / 3 alone, main after FX1).
- Known flake (sprint 9): `e2e/roll-popup.e2e.ts` FR-DICEX-39–41 under a loaded full run (3 / 3 alone, main after PM1 + FX2).
- Known flake (sprint 9): `strongholds/con44.test.ts` "REM / HOLD §12 CON-44 at the caps" hits the 5 s default timeout under load (passes alone; FX3 sets a 30 s timeout).
- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
