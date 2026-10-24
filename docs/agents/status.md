# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 10 slices merged, session-sim-14 13 / 13. Recap part 1 (#343): DM asked for the **Dice tray +40 %** before closing, and accepted BL-111 / BL-114 picks → slices **T1** `fix/dice-tray-size`, **T2** `fix/s10-dm-calls` running; recap part 2 (#344): **T3** `fix/stats-campaign` (Stats Campaign tab, first) running. Then: walkthroughs, merge, main gates, update the Playtest section, pause for the rest of the recap.

**Gates on `main`:** detached worktree `~/.herdr/worktrees/pocket-plane/gates-main` (recreated for T1 / T2); `gates.sh <it> <tag>`; `main`'s own `dist/` is never rebuilt.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Sprint 9 (RS0–3, PM1–2, FX1–3, SP1–3) | all merged | — | done | — |
| Sprint 10 H1 combat + dice | merged cf97ba09 | — | **merged** (walkthrough 7/8 → re-test 5/5; branch check 5557 / e2e 231); evidence `.verify/sprint10/walkthroughs/20261024-h1{,r}/`; main gates green (5557 / 231) | — |
| Sprint 10 H2 window frame + Party Manager | merged 47409405 | — | **merged** (walkthrough 5/6 → re-test 5/5; branch check 5565 / e2e 235); evidence `.verify/sprint10/walkthroughs/20261024-h2{,r}/`; main gates green (5565 / 235) | — |
| Sprint 10 H3 toasts | merged 8b279504 | — | **merged** (walkthrough 5/8 → re-tests 7/8, 9/10, 12/12; branch check 5587 / e2e 237 + known combat2-polish FR-CBT-75 flake, 3 × 8/8 alone); evidence `.verify/sprint10/walkthroughs/20261024-h3*/` ; main gates green (5587 / 238), bench 41 / 41 | — |
| Sprint 10 H4 rules, recap, strongholds, misc | merged cf9e0fbe | — | **merged** (walkthrough 11/11, branch check 5545 / e2e 229); evidence `.verify/sprint10/walkthroughs/20261024-h4/`; main gates green (5545 / 229) | — |
| Sprint gate | final main 8b279504 | — | **session-sim-14 13 / 13 PASS** (leak scan clean; hard kill byte-identical); glitches → BL-107–BL-114 | DM recap |
| Sprint 10 T1 Dice tray +40 % (#343) | `fix/dice-tray-size` (slot 0, ws wAA) | build-t1 | building (holds the frame lock: size table, goldens, replay sets) | walkthrough (port 4103) |
| Sprint 10 T2 DM calls BL-111 + BL-114 (#343) | `fix/s10-dm-calls` (slot 2, ws wAB) | build-t2 (idle), test-t2 | ready (check 5593, e2e 240) → walkthrough (port 4123) | merge (before T3) |
| Sprint 10 T3 Stats Campaign tab (#344) | `fix/stats-campaign` (slot 4, ws wAC) | build-t3 (idle), test-t3 | built (bench 12.7 / 18.2 ms) → walkthrough (port 4143); then merge main after T2 + apply BL-111 to awards won | merge |

Backlog after sim-14: BL-107–BL-110, BL-112, BL-113 (small, open); BL-111 and BL-114 need a DM call; BL-93 open (27 player harness cells).

## Shared-file locks

- T1: play-shell size table / goldens / replay sets (frame lock).

## Integrator rulings this sprint (tell the DM at the recap)

*(Sprint 10: add new rulings above the sprint-9 list.)*

Sprint 10:
- T2 BL-111: players' "Most damage dealt" is withheld per session when damage to creatures hidden from them could change its winner; BL-114: pet presence ignores a DM-hidden combatant (non-owners get a delete, back on show); pre-fix hidden pets update on their next write (accepted). Recap reads two new stats exports (FR-STATS-78 note).
- T3 Campaign tab: party rows only (DM too, as Trophies), companions roll into their owner, monsters slain counts any attacker, record ties → earlier fact, all tie winners counted for awards won, DM record labels encounter + day / players "Fight N · day"; players' awards won drop Most damage dealt where T2 withholds it; table scrolls sideways inside today's 400 × 412 window.
- H1 BL-103: players' "Biggest overkill" amount was the hit's damage (allowed by FR-STATS-12), not a leak; players now read "N damage" on Session, recap Awards, Highlights and Trophies; DM unchanged (FR-STATS-12 amended).
- H1 BL-97: Add hidden hides a bound visible token like the map's hide; never unhides; Start keeps a bound token's own hidden flag (accepted as is).
- H1 BL-105: a player's own hidden-request answer follows their dice settings; the DM's own hidden rolls stay popup-only (FR-DICEX-84 amended).
- H1: granted the stale `DamageRolled` comment fix in `src/shared/events/combat-tracker.ts` (no other holder); one-line role pass in session-recap award views (H4's area; merge order sorts it).
- H3: the stack's slide toward the map's top-left stays capped (DM #288: never over the map's top-left / tokens), so a crowded Rules case folds instead of moving left of Rules; two unfoldable "Saved" alerts + a card that can't fit above Rules sit on Rules' body over the fewest controls (FR-NOTE-71 fallback, accepted).
- H2: "windows stacked at 480,60" in a crowded DM 1280x720 (H3 re-tests) = put-away windows (minimised, rect kept), not open overlap; by design (FR-SHELL-152); regression test added. Walkthrough rect helpers count only `[data-state="open"]` windows.
- H2 FAIL 5 fix: a window moved / grown by an upward resize returns on the way back; growth past useful only if the map keeps an all-tokens fit; the canvas remembers its fitted camera per viewport size (keyed on scene, tokens, stored layout). Fit with a window left mid-map at 1280 still gives the PCs-only view (no all-tokens view exists).
- H2 re-test notes for session-sim-14: a hidden pet's redacted entity (name, owner, band) stays in other players' snapshots with no row shown (FR-ENT-37 `petPresent` counts the hidden combatant; FR-PARTY-61 "no row" holds): spec-consistent, raise at recap; DM Party Manager at 1280 opens 346 / 368 (band-capped below useful); Initiative minimised after a no-fight DM reload (check).
- H3 re-test 2 O1 (stack folds with 2+ live cards next to PCs): PC rule, accepted.
- H2 BL-104 pet chip: a hidden pet's combatant never reaches its owner (ADR-0056), so the owner shows no "In combat" chip; DM keeps chip + eye-off (FR-PARTY-61 note). Leak-safe.
- H2 BL-99: new shrink-in-place rung before put-away (never below useful, grow back on close). Where PCs fill the free area, or players in a fight at 1280x720 (576 px between Initiative and sheet), one window is still put away: PCs first stays (ADR-0060 / #310). Two DM windows.test.ts checks relaxed to the goldens' 4-px gap ranking (accepted).
- H2: 27 player "moved @1280x720" harness cells (360-px-tall windows vs the toast corner) stay named exemptions (BL-93); harness DM 10 → 7, players 37 → 31.
- H2 edited `free-area.ts` (frame, H2 holds the frame lane): fine.
- H1 walkthrough note: Fog → Reveal all flipped a downed, fog-hidden (not DM-hidden) Goblin combatant to public: fog-derived visibility, by design; re-check in session-sim-14.
- H4: stronghold Delete confirm fixed like the facility one; DM-only badge not in search results (summary has no flag), accepted; recap re-ask delay 2 s → 1 s (FR-RECAP-06 note); BL-102 `[label](url)` shows only its label (no outbound links).
- H3 walkthrough step 5 (crowded screen, stack over Rules' first cards): accepted as the FR-NOTE-71 fallback.
- H3: "Saved …" toasts stay alerts in the one stack (FR-NOTE-50), placed like cards; new FR-NOTE-75 (content-aware spots), -76 (modal dialog as a keep-out).

- Toast stack: a window's title bar + first 40 px keeps the DM / player toast stack out (amends FR-NOTE-53; FX1 build, 2026-10-23), fallback FR-NOTE-71.
- Placer speed-up 3 (`roomFor`, exact) kept for the 25 ms bench gate (OQ-SHELL-84).
- Party Manager 550 px: 20 new player harness cells approved as named exemptions (BL-93).
- Launcher labels (SP2 re-test): with Rules added, the DM's launcher at 1280 shows icons only (threshold 1434 px); players keep full labels at 1280 (1044 px); per FR-SHELL-43 / #245.
- Walkthrough step wording fixed: live-sync FX3 step 4 (ellipsis only when the name doesn't fit), play-shell SP1 P3 / P8 (fixture pets).

## Pending DM decisions

- Rest of the recap: sprint 11 scope (BL-111 / BL-114 decided, #343).

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
