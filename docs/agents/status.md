# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** **Sprint 14 RESUMED (2026-10-28) on the CI test loop (#368, AGENTS §9.4.1).** F2 merged (6ce69034), F1 merged (2c493f7a). F4 walkthrough running (`test-s14f4`, port 4133). F3 building (`build-f14c`, worktree fix-s14-kit, workspace w70, slot 0). Decisions up to #371. All worktrees are linked to workspace wR (`herdr worktree create/open --workspace wR`).

**Resume (in order):**
1. ~~Build the test tooling~~ **done (#368, #369):** GitHub CI on every push (`.github/workflows/ci.yml`: unit 6 parts, e2e 12 shards with one retry → flaky, ~3.5 min), nightly bench + Windows, screenshot baselines (`e2e/visual.e2e.ts`, refresh via `screenshots.yml`), targeted local `bun run check`, `bun run ci:watch` in the background after each push, fixture bundle snapshot cache, hot-file speed-ups, BL-128 / BL-140 fixed. Rules: [AGENTS §9.4.1](../../AGENTS.md#941-the-test-loop-targeted-locally-everything-in-ci). `gates.sh` now pushes + waits for CI (nothing heavy locally).
2. **Resume sprint 14 on the new loop** ([sprint-14](sprint-14.md)): parked branches with a `.verify/resume.md` each: **F1** `fix/s14-frame` (worktree fix-s14-frame, slot 0; BL-129, BL-134, BL-136, BL-133 committed, not yet walkthrough-tested) and **F2** `fix/s14-toasts` (worktree fix-s14-toasts; BL-130, BL-132, BL-137, BL-131 committed, not yet walkthrough-tested). Merge main into each (both predate the CI loop: tell the builder AGENTS §9.4.1 replaces the brief's `check:full` / gates steps), targeted `check` + the slice's own e2e specs, push + `ci:watch` in the background, walkthrough, merge (no wait for CI). Then **F4** `fix/s14-roll-guard` (BL-135, DM #367), then **F3** kit nits (BL-138, BL-139, BL-141).
3. Briefs / slice definitions: `%TEMP%/pocket-plane/slices.json` keys `f14a`, `f14b` (backup with the two briefs in `.verify/sprint14/`); walkthrough templates `%TEMP%/pocket-plane/briefs/tpl-test-*.md`.


**Gates on `main`:** GitHub CI (#368). After each merge: push `main`, `bun run ci:watch` in the background; red `main` is fixed first. The local `gates-main` worktree is no longer needed (remove it at the next cleanup).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Sprint 9 (RS0–3, PM1–2, FX1–3, SP1–3) | all merged | — | done | — |
| Sprint 10 H1 combat + dice | merged cf97ba09 | — | **merged** (walkthrough 7/8 → re-test 5/5; branch check 5557 / e2e 231); evidence `.verify/sprint10/walkthroughs/20261024-h1{,r}/`; main gates green (5557 / 231) | — |
| Sprint 10 H2 window frame + Party Manager | merged 47409405 | — | **merged** (walkthrough 5/6 → re-test 5/5; branch check 5565 / e2e 235); evidence `.verify/sprint10/walkthroughs/20261024-h2{,r}/`; main gates green (5565 / 235) | — |
| Sprint 10 H3 toasts | merged 8b279504 | — | **merged** (walkthrough 5/8 → re-tests 7/8, 9/10, 12/12; branch check 5587 / e2e 237 + known combat2-polish FR-CBT-75 flake, 3 × 8/8 alone); evidence `.verify/sprint10/walkthroughs/20261024-h3*/` ; main gates green (5587 / 238), bench 41 / 41 | — |
| Sprint 10 H4 rules, recap, strongholds, misc | merged cf9e0fbe | — | **merged** (walkthrough 11/11, branch check 5545 / e2e 229); evidence `.verify/sprint10/walkthroughs/20261024-h4/`; main gates green (5545 / 229) | — |
| Sprint gate | final main 8b279504 | — | **session-sim-14 13 / 13 PASS** (leak scan clean; hard kill byte-identical); glitches → BL-107–BL-114 | DM recap |
| Sprint 10 T1 Dice tray +40 % (#343) | merged 4c356249 | — | **merged** (walkthrough 18/18; branch check 5602 / e2e 241 + FR-CBT-75 toast flake → BL-115); evidence `.verify/sprint10/walkthroughs/20261024-t1/` ; main gates (T1 + T3): check 5626 green, e2e 241 + 2 load flakes (colour-picker-2, prefs-window: 1 s expect timeouts; 2 × 3/3 alone → T4) | — |
| Sprint 10 T2 DM calls BL-111 + BL-114 (#343) | merged ef4835d1 | — | **merged** (walkthrough 11/11; branch check 5593 / e2e 240); evidence `.verify/sprint10/walkthroughs/20261024-t2/`; main gates green (5593 / 240) | — |
| Sprint 10 T3 Stats Campaign tab (#344) | merged 9cceead1 | — | **merged** (walkthrough 7/7; branch check 5617 / e2e 241); main gates skipped (tree = tested branch, #345); evidence `.verify/sprint10/walkthroughs/20261024-t3/` | — |
| Sprint 10 T4 faster test loop (#345) | merged aa9ddba0 | — | **merged** (branch check:full 5634 / e2e 243 at 4 workers, 752 s wall for the whole gate); main gates skipped (same code) | — |
| Sprint 10 T5 dice visuals (#347, #348) | merged bfdc44a9 | — | **merged** (visual walkthrough PASS; branch check:full 5635, e2e 242 + weapon-rows load flake 2/2 alone); main gates skipped (same code) | — |
| Sprint 11 F1 frame + camera | merged 0b628f94 | — | **merged** (re-test 6/6; branch check:full 5651 / e2e 250/250); main gates skipped (same code) | — |
| Sprint 11 F2 toasts | merged 9da2b751 | — | **merged** (re-test 8/8; branch check:full 5667 / e2e 253/253; import sort after merge) | — |
| Sprint 11 F3 combat + dice | merged 878b2549 | — | **merged** (walkthrough 16/16; branch check:full + e2e green bar load flakes pause / popup-line → BL-116); main gates skipped (same code) | — |
| Sprint 11 art track (DM) | merged f118e724 (theme-system), 56347ecf (charx print sheet) | — | **merged** (#351; ADR-0069); #352: theme-system complete, OQ-CHARX-47–50 all A | art build in sprint 12 |
| Sprint 11 gate | final main 9da2b751 | — | **session-sim-15 10 / 11 PASS** (leak scan clean; hard kill byte-identical); FAIL c → BL-118; glitches → BL-119–BL-123 | DM recap |
| Sprint 12 T0 theme tokens | merged 2c5a379f | — | **merged** (Default pixel-identical walkthrough PASS, `.verify/sprint12/walkthroughs/20261025-th0-default-identical/`; check:full 5767, e2e 252 + gems-reroll load flake 1/1 alone); main gates skipped (docs-only since tested) | — |
| Sprint 12 CS printed sheet | merged f4b51d8e | — | **merged** (walkthrough 18/19 → re-test 24/24; check:full 5788 + shutdown load flake, e2e 254 + weapon-rows load flake, both pass alone) | — |
| Sprint 12 X1 toasts (BL-118–120) | merged b46c010b | — | **merged** (walkthrough 2/5 → re-test 5/5; check:full 5807, e2e 261/261) | — |
| Sprint 12 X2 stats + skip toast + flakes (BL-121, -122, -116) | merged beacd9e6 | — | **merged** (walkthrough 4/4; check:full 5797, e2e 256/256) | — |
| Sprint 12 T1 theme switch | merged a15785ed | — | **merged** (walkthrough PASS; check:full 5835 + no-copy load timeout, e2e 259 + 3 load flakes: cb-party, dice-extras, popup-line (popup-line again after BL-116), all pass alone) | — |
| Sprint 12 T3 default theme (#355) | merged fac01c26 | — | **merged** (walkthrough PASS; check:full 5856, e2e 264/264) | — |
| Sprint 12 T2 Gilt & Stone | merged 1873122d | — | **merged** (walkthrough 11/12 → re-test 13/13; check:full 5852, e2e 264/264) | — |
| Sprint 14 F1 frame | merged 2c493f7a | — | **merged** (walkthrough 4/6 → re-test 5/5 `.verify/sprint14/walkthroughs/20261028-s14f1{,r}/`; check 1030 targeted, replay 418/418, CI green; player-gilt.png refreshed; tool-bar return after a grow fixed, pre-existing) | — |
| Sprint 14 F2 toasts | merged 6ce69034 | — | **merged** (walkthrough 9/9 `.verify/sprint14/walkthroughs/20261028-s14f2/`; check 763 targeted, area e2e 19/19, branch + main CI green) | — |
| Sprint 14 F4 roll guard | `fix/s14-roll-guard` (w7Y, slot 3) | build-f14d, test-s14f4 | ready per #371 (CI green 772c823d after one flake re-run → BL-147) | walkthrough → merge |
| Sprint 14 F3 kit nits | `fix/s14-kit` (w70, slot 0) | build-f14c | building | walkthrough |
| Spell FX (VFX, #372) | — | — | spec in-review, merged 3939d353; ADR-0071 proposed | build slices after sprint 14: VFX core (`fix/vfx-core`: schema `effect.fx` / `spells[].fx` + data model, protocol hit cue + after-commit listener, scenes-map LAYER_ORDER, FX preset / hit look / CHARX spell-row action registries) → VFX build (renderers, Cast, Preferences, Layers, token menu) → §13 walkthrough. Core holds schema + protocol + CHARX locks: not alongside F3 (character-sheet) |

Backlog after sim-15: BL-118 (toast + popup flicker on each new card, the FAIL), BL-119, BL-120, BL-122, BL-123 (small); BL-121 needs a DM call (extend BL-111 to every award); BL-116 flakes; BL-93 (27 player cells).

**Resource rule (#354, #368):** heavy test runs happen in CI only; locally targeted `check` / single specs. One heavy local job at a time still holds for walkthrough servers and session-sims; `PP_TEST_SHARDS=3` in every worktree `.env`.

## Shared-file locks

- `styles.css`, both `index.html`, the dice tray's `data-slot` → `data-die-slot` rename (`roll-control.tsx` attribute lines + 3 tests): **T1** (T0 merged). 

## Integrator rulings this sprint (tell the DM at the recap)

Sprint 14:
- F1: `tray-size.test.ts` expectation → the tray's useful 360×300 with Fit `all` at DM 1440 escort (the BL-134 rule applies to the tray; 450×375 gave Fit `pcs`). The 6 remaining K5 replay exemptions stay out of F1 (backlog rows after the report; the zone round-trip memory is a DM design question).
- F2: DM bell = unread pending actions only; a player's not-owned pending rows get their own Waiting section; the popup head limit applies only to a displaced column (#347 counts at home); the stuck-hover toast timer (a 4 s card stayed > 60 s) is fixed in F2.
- F1 walkthrough step 3: launcher button rects differ between themes by up to 8 px (label text drawn in each theme's font); the labelled set and the fit decision are identical (BL-136 / FR-THEME-07): accepted.
- F4: definition rolls (stat block, NPC sheet) check every instance; fog counts per player (seen by only some players → DM-only); the roll bar's public switch the server will override → F3.

Sprint 11:
- F1 1c fix: a resize up also gives untouched windows their fit-keeping size (returns on the way back); after a reload at the larger size the return to the smaller size is not remembered (accepted). F2 1b / 2a fix: once every card folds, "+N more" joins the summary row (stack stays 58 px).
- F2 BL-115: refold only after 250 ms of layout stillness, draw once per fold (hold ≤ 300 ms), read card targets / PCs as footprints (FR-NOTE-77 note). BL-108 (FR-NOTE-78): fallback avoids headings and first records first; the damage-card popup blocks like Initiative, else fold. g01 lands right of "Party pot" (accepted). FR-FIX-03 every-bundle test timeout 60 → 300 s (granted; ~190 s under load).
- F1 BL-107: an untouched launcher window grows past useful only where Fit still frames every token (all placements): DM 1440 mid-fight Party Manager opens 440 × 400, not 600 — **raise at recap** (DM #341 asked 600; 600 still where it fits). BL-109: new rung L3r moves one other untouched window aside at its size before a put-away (amends invariant I5): accepted. Launcher labels drop one at a time (10 / 17 at DM 1440 test mode). Party Manager over the enemy line: no spot of useful size avoids tokens; covers 10 / 20 (was 14). Harness DM 7 → 6 (last DM exemption retired), players 30 → 29.
- F3 BL-110: the reported "After Mira" case already toasts; the gap was "In Mira's turn" companions (no rank): now named in the DM's skip toast on the owner's turn (Next / Prev, Initiative and palette), DM only. BL-113 "Add hidden" default: current behaviour confirmed (dated note FR-CBTX-44). F3 edited `palette/launch.tsx` (palette, not F1's launcher): accepted.


*(Sprint 10: add new rulings above the sprint-9 list.)*

Sprint 10:
- T5: the toast keep-out box stays sized for the old 320 × 190 popup (growing it breaks default layouts / replay cells); the bigger popup may spill ~92 px left / 30 px up past it for its 6 s (spec allows a tall stack to); fewer full popups at once on short screens (players 1, DM 2 at 1280 × 720). Known flake: `pause.test.ts` FR-CAMP-47 once in check:full (3/3 alone).
- T1 Dice tray: 504 × 420 default with 56-px dice; 360 × 300 counts as a previous default so unremembered trays grow, remembered keep their size; where PCs leave little room the tray opens at useful 360 × 300, so the dice there must still be ≥ 48 px (wrap rows), only the 300 × 240 min may stay at 40 px (FR-DICEX-96). Harness delta 0.
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


- **Next after sprint 12 (DM #354): a new test strategy** before feature work: the loop is too slow / heavy. Bring a proposal at the recap.

- Default theme decided (#355: Gilt & Stone; old look = Simple Dark). Kit-parity spec: review its open questions when it's in review.

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
