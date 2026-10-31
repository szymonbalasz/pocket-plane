# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

## Now (2026-10-31)

**State:** no sprint running. Sprint 14 closed (#381); since then the DM's asks were built one by one on `main` with no sprint plan: the `play` command, tray attacks, Assets window, 5etools import, overview scenes, scenes list drag and folders, doors replacing walls, fog edges, exact explored memory, search clear, game log menu (#382–#412). The DM's real campaign runs from `bun run play`: never touch `%LOCALAPPDATA%/PocketPlane`, its backups or port 4090.

**Next:** session-sim-17's findings if any are serious, then **linked notes with backlinks** (next big feature, #413), then the quest log, in-game calendar and session timeline.

**Session-sim-17:** in progress on `fix/housekeeping-sim` (the first full run since sim-16 on 2026-10-26).

**Backlog candidates still open:** window frame BL-146 (approved, unbuilt) with BL-143–145; BL-124 / BL-152; toasts BL-151; kit look BL-149 / BL-150; AoE label BL-153; CI flakes BL-154 / BL-158 / BL-159; slow commands BL-142; small BL-123, BL-155–157, BL-164–171. **Waiting on the DM's call on migrations:** BL-172 (schema push crash), BL-173 (upgrade check).

**Shared-file locks:** none.

**Briefs:** `%TEMP%/pocket-plane/briefs/`.

**Gates on `main`:** GitHub CI (#368). After each merge: push `main`, `bun run ci:watch` in the background; red `main` is fixed first.

**Herdr:** agents `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

**Resource rule (#354, #368):** heavy test runs happen in CI only; locally targeted `check` / single specs. One heavy local job at a time still holds for walkthrough servers and session-sims; `PP_TEST_SHARDS=3` in every worktree `.env`.

## Integrator rulings this sprint (tell the DM at the recap)

Sprint 14 (reported, accepted at the recap #381):
- F1: `tray-size.test.ts` expectation → the tray's useful 360×300 with Fit `all` at DM 1440 escort (the BL-134 rule applies to the tray; 450×375 gave Fit `pcs`). The 6 remaining K5 replay exemptions stay out of F1 (backlog rows after the report; the zone round-trip memory is a DM design question).
- F2: DM bell = unread pending actions only; a player's not-owned pending rows get their own Waiting section; the popup head limit applies only to a displaced column (#347 counts at home); the stuck-hover toast timer (a 4 s card stayed > 60 s) is fixed in F2.
- F1 walkthrough step 3: launcher button rects differ between themes by up to 8 px (label text drawn in each theme's font); the labelled set and the fit decision are identical (BL-136 / FR-THEME-07): accepted.
- F3: notice stack with no clear spot → compact one-line summary (200 px), placed again (FR-NOTE-79); the roll bar's eye uses the shared roll-guard helper, but per-player fog never reaches the DM client, so a token only some players see is still forced DM-only by the server while the eye stays on (accepted: the server is the guard); stat-block empty space → BL-149, attack property chips → BL-150; damage card stays 440 px (FR-KIT-66) — **raise at recap** (330 needs a card redesign).
- VFX core: Goblin Sneak (renamed) attacks stay DM-only → no player cue; walkthrough S6 applies the hit by hand. Cast from a monster's sheet with several of its combatants in the fight → conflict (kept). Compendium Add to sheet fills fx in the build slice.
- AoE #377: a template records an optional origin-square count (1 = a square, 2–4 = a Large / Huge / Gargantuan footprint; absent = exact > 50 % rule), so the server and every client read the rule from the record; stored rows keep their squares.
- VFX build: players open Show / Hide affected cells from the map's right-click menu (no player token menu; FR-VFX-23 note); hit looks stay full at Reduced (FR-VFX-26 cap is per preset).
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



- Migrations: BL-172 and BL-173 wait on the DM's call.
- Session timeline (tier A, #413) vs ADR-0013's "no session entity": settle in the spec phase.

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
