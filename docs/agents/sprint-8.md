# Sprint 8: window-frame pass, table tools, stats tier B, combat polish

DM decisions #333 (sprint-7 recap: a window-frame pass with a stated 1280×720 priority), #334 (sprint 8 scope). Process: [orchestrator prompt](orchestrator-prompt.md) (incl. **§3a backfill**), [continue-session §3](continue-session.md#3-herdr-how-to-run-agents-learned-the-hard-way) and its lessons (sprint 7's first). Sprint 7 for reference: [sprint-7](sprint-7.md) (same loop: specs in parallel → seams → reviews → one DM gate → builds per hotspot rules → walkthroughs → session-sim → playtest section → recap).

## Tracks

"sim-11" = the [session-sim-11 report](../../.verify/20261021-190115-session-sim-11/report.md) (local, gitignored; copy into each worktree) and the "Known gaps" of [Playtest: sprint 7 features](sprint-7.md#playtest-sprint-7-features).

| Track | What | Specs | New / revised | Prefix |
|---|---|---|---|---|
| **WF** window-frame pass | **One placement path, proven on real sessions** (#333). Today five paths place windows (auto placement, reopen, tool-bar pushes, viewport resize, reveal / load refits) and each sprint fixed one while another broke. Settle them on one placer with one rule: **at small screens, PCs stay clear first, then windows shrink (not below their useful size unless nothing else works), then the least recently used launcher window is put away** (#333; only player characters count as PCs, #318). Fix: **BL-64** windows on Mira at DM 1280×720 although a clear strip existed (sim-11 FAIL g); **BL-65** a player's reveal refit zooms *in* with the companion card open (sim-11 FAIL h); **BL-60** shell-shrunk windows don't grow back when the viewport grows; **BL-61** tool-bar pushes ignore the PC rule; **BL-66** Stats and the companion card open at their minimum when crowded (names cut, attacks below the fold); **BL-70** Player 1's Initiative jumps mid-map after Start; **BL-59** the toast stack stays low after a tool closes; **BL-52** a window dragged under a shown tool bar; **BL-53** the tool rail overlaps window content at 320 px. **Test: a session-replay layout harness** — real window sets from sim-10 / sim-11 states (fight running, Game log + Initiative + launcher windows, companion card, Stats) at 1280×720, 1280×800, 1440×900, 1600×900, DM and player, through every path (open, reopen, push + return, resize down + up, reveal, load, Start), each asserting: no PC footprint under a window, no overlap, every window ≥ its useful size or put away | [play-shell](../specs/play-shell.md), [scenes-map](../specs/scenes-map.md) (refits), [notifications](../specs/notifications.md) (toast stack), [stats](../specs/stats.md) (window size row), [character-sheet-full](../specs/character-sheet-full.md) (companion card size) | Revise | SHELL, MAP, NOTE |
| **TT** table tools | Tier A / B "at the table" items: **saved macros / custom roll buttons** (a player's or the DM's named roll buttons, e.g. "Sneak Attack 3d6", "Bless 1d4", one click → the normal roll path incl. physical dice and the tray), **DM requests a roll from players** (a notification with a roll action: "Everyone: Perception", "Mira: DEX save DC 15", results back to the DM, hidden or public per the request), **pause / intermission screen** (the DM pauses the table: players see a full-screen pause card with an optional message / image, input blocked; the DM keeps working), **DM-added alert sounds** (the DM uploads short audio files and picks them for alerts such as "your turn", a roll request, the pause). Promote the post-MVP dice-extras stub's macros / roll-request parts | [dice-extras](../specs/dice-extras.md) (macros, roll requests; fold in [post-mvp/dice-extras](../specs/post-mvp/dice-extras.md)), [dice-roll-log](../specs/dice-roll-log.md) (request results in the log), [notifications](../specs/notifications.md) (roll-request kind), [play-shell](../specs/play-shell.md) (pause screen, sound settings), [assets-pipeline](../specs/assets-pipeline.md) (audio assets), [character-sheet-full](../specs/character-sheet-full.md) (macro buttons on the sheet) | Revise | DICEX, DICE, NOTE, SHELL, ASSET, CHARX |
| **SB** stats tier B | On top of the sprint-7 read models (ADR-0059): **kill-feed toasts** ("Thorn finished the Ogre, overkill 37"), **character trophy case** (campaign-wide records on the character: biggest hit, kills, nat 20s, times downed…), **dice luck tracker** (average d20, nat 20s / 1s per character, per session and campaign), **end-of-combat summary** (a popup at End with the fight's leaderboard and highlights). Same visibility rules as tier A (hidden rolls / monsters never leak; players see public facts only) | [stats](../specs/stats.md), [character-sheet-full](../specs/character-sheet-full.md) (trophy section), [notifications](../specs/notifications.md) (kill-feed kind), [combat-tracker](../specs/combat-tracker.md) (End → summary) | Revise | STATS, CHARX, NOTE, CBT |
| **CB** combat polish | Tier B: **drag to reorder initiative** (the DM drags a row; ties and manual order kept per fight; companions follow their turn mode), **highlight the current-turn token** on the map (ring / glow for everyone who can see the token), **party HP / AC summary for players** (a compact party strip or window: each PC's HP / AC, companions per ADR-0056; monsters never) | [combat-extras](../specs/combat-extras.md) (reorder), [combat-tracker](../specs/combat-tracker.md) (order, turn), [scenes-map](../specs/scenes-map.md) (turn highlight), [play-shell](../specs/play-shell.md) / [party-board](../specs/party-board.md) (party summary) | Revise | CBTX, CBT, MAP, SHELL, PARTY |

**Backlog for idle slots (DM #286 rule):** BL-54 (offline chip lag), BL-57 (dice numbers as HTML for copy / paste), BL-62 (reroll line repeats old damage), BL-63 (one event per gem spend), BL-68 (batch award lines), BL-69 (Stats default fight / fixture dates), BL-71 (duplicate toasts on Stats), BL-72 (small copy); whatever else fits §3a. **Not** the frame items above (WF owns them).

**Not this sprint:** 5etools class import / levelling; **the UI / art sprint** (BL-29); world-builder (wikilinks, NPC directory, journal, map pins); campaign manager / session recap; agent / MCP API; single executable; Obsidian importer; rules quick reference; keyboard shortcuts / command palette; DM homebrew file import.

## Orchestrator: how to run this sprint

**Phase A: specs (one DM gate)**
1. Start **all four** spec agents at once: **WF**, **TT**, **SB**, **CB**. Copy inputs into each worktree (this file, the session-sim-11 evidence `.verify/20261021-190115-session-sim-11/`, the sprint-7 playtest section). Pre-assign new FR / OQ ID ranges per track in each brief for every shared spec (compute the current maxima first).
2. Each spec agent: options + bold pick per open question, a **measured** CON-44 figure for anything new in the snapshot or per-event traffic (heavy harness probe; DM ceiling 1.5 MiB, players 512 KiB, #256; last measured DM worst ≈ 942 KB), named tests, a §13 walkthrough, a build split with the shared files each slice touches, and the **dependency** it needs, if any, with alternatives (TT: audio playback / upload — none expected beyond the browser's Audio; check).
3. Settle seams yourself (one `seams.md`, copied into each worktree; authors push back once). Expected seams: **WF ↔ TT** (the pause screen and the roll-request prompt vs the placer: overlays, not windows? keep-outs?), **WF ↔ SB** (the end-of-combat summary popup and kill-feed toasts vs the toast stack and the placer), **WF ↔ CB** (the party summary strip / window vs the placer and default sizes; canvas lock: WF's refits vs CB's turn highlight), **TT ↔ SB** (roll-request results and macro rolls in the luck tracker: which rolls count), **SB ↔ CB** (a manually reordered initiative in the end-of-combat summary; nothing expected), **TT ↔ CB** (a roll request mid-fight vs turn alerts / sounds), **notification kinds** (TT roll request, SB kill-feed, WF toast stack: append-only registry, one toast policy).
4. Reviews: **two** review agents in parallel (review-a: TT + SB; review-b: WF + CB), then `rulings.md`, authors apply.
5. **DM gate 1**: every pick that needs the DM, scope cuts per track, **new dependencies** (none expected), ADR acceptance (likely: a placement ADR for "one placer, PCs first, then shrink, then put away"; maybe roll requests as a pending-action kind, check ADR-0016), build order. Integrate (number ADRs, index, glossary, registries in AGENTS §9.9, log) and merge the spec branches.

**Phase B: builds**
6. Cores first, one schema lane per conflict set (TT: macros table, roll requests, audio assets; CB: a manual initiative order if it needs a column; SB: nothing expected — read models), then feature slices in parallel wherever the hotspot table allows. Stack a slice on an unmerged branch once that branch passed its walkthrough (sprint-7 lesson). Small slices in the same area go to one builder with one walkthrough.
7. Every slice: builder → "ready for walkthrough" → test agent → fixes → `check` + full `e2e` in the branch after merging main → merge → `check` + full `e2e` on `main` (**never merge into `main` while its gates run**; never background with `&`). Run `resolve_docs.py` after every merge (duplicate-number warning); `mergemain.sh` finishes a conflicted merge in a worktree. Backlog backfill when a slot is idle (DM #286), never ahead of an unblocked sprint slice; stop once the last sprint slices are in flight.
8. Sprint gate: session-sim-12 on final `main` (bundle = session-sim-11 + sprint-8 units; incl. the WF session-replay layouts in a real browser at 1280×720 / 1440×900 (no window on a PC, nothing at a cut size, resize down and up recovers, reveal with the companion card open), a saved macro on the sheet and in the tray, a DM roll request to everyone and to one player (hidden and public), the pause screen on and off, a custom alert sound, kill-feed toasts, a trophy case, the luck tracker, the end-of-combat summary at End, a dragged initiative order, the current-turn highlight, the players' party summary), leak scan per player, a "Playtest: sprint 8 features" section here, then **pause and recap with the DM**.

## Progress (updated as slices merge)

| Date | What |
|---|---|
| 2026-10-21 | Phase A started: WF, TT, SB, CB spec agents at once, new FR / OQ ID ranges per track |
| 2026-10-21 | Seams S1–S16 settled; review-a (TT + SB) and review-b (WF + CB) done, rulings applied; **DM gate 1** sent (4 proposed ADRs, no new dependencies) |
| 2026-10-22 | **Gate 1 passed (#335)**: all picks; ADRs 0060–0063 accepted; specs merged. Wave 1 builders started: WF1 placer core + replay harness, TT0 table-tools core, SB0 stats core, CB0 combat core |
| 2026-10-22 | **TT0 merged** (table-tools core: macro / roll-request / audio tables, pause + sound fields, session-sim-12 bundle; walkthrough 6 / 6). TT3 alert sounds started |
| 2026-10-22 | **CB0 merged** (combat core: tie order, `cbtx.moveCombatant`, numbers never leak; walkthrough all PASS incl. leak scan + hard kill). CB1 drag reorder started |
| 2026-10-22 | **TT3 merged** (DM-added alert sounds: upload limits + probe, picks in Campaign options, Chime / ping playback, mute wins; walkthrough 15 / 15). TT1+TT2 macros + roll requests started; main after TT3: check 4536 / e2e 187 green. WF4 toast policy + sizes started; SB0 walkthrough 10 / 10; CB1 drag reorder in walkthrough |
| 2026-10-22 | **CB1 merged** (drag to reorder initiative: grip, drop line "→ n", keyboard Move up / down, crossing hint; walkthrough 14 / 14 + autoscroll / tooltip fixes). WF1 walkthrough passed after a reload fix (L5 never worse than the current rect); SB0 fixing its session-sim-12 unit (past Bandit fight) |
| 2026-10-22 | **WF1 merged** (one window placer for open / reopen / resize / load / Start, zones, put away, grow-back, session-replay harness: failing layout cells 307 → 166, the rest are pushes and camera; walkthrough 10 / 10 after a reload fix). TT1+TT2 part-1 walkthrough 13 / 13. WF3 map refits and TT4 pause screen started |
| 2026-10-22 | Main after WF1 + CB1: check 4938 / e2e 193. **SB0 merged** (stats core: kill flag on lines, Highlights, luck incl. the owned-creature ruling, trophies, campaign numbers prepared at start, End summary notification; walkthrough 10 / 10). WF2 pushes + rail started; WF4 and TT4 (part 1) in walkthrough |
| 2026-10-22 | Main after SB0: check 4984 / e2e 194. **WF4 merged** (one toast stack per client: card / alert / info / callout classes, ≤ 3 + "+N more", alerts never hidden, stack returns home in < 0.1 s (BL-59), steps aside from windows; Stats, companion card and Notifications fit their useful sizes (BL-66); walkthrough 8 / 10 → re-test 5 / 5). WF2 pushes walkthrough 13 / 14. CB3 Party status and SB1+SB2 stats UI started |

## Check `main` any time (DM)

Bundle **`session-sim-11`** until the sprint adds `session-sim-12`.

```powershell
git pull; bun install
bun run build
bun run fixtures:reset-load session-sim-11 --profile verify
bun run start --profile verify
```

## Boundaries and hotspots (sequence these)

| Overlap | Rule |
|---|---|
| Play-shell frame (`placement.ts`, `manager.ts`, `free-area.ts`, `ShellWindow.tsx`, keep-outs) | **WF owns** all sprint; TT's pause screen / roll-request prompt and CB's party summary register through registries (append) after WF's frame core; SB's summary popup uses the toast / popup rules WF sets |
| Canvas (`MapCanvas.tsx`, `TokensLayer.tsx`, `LabelsLayer.tsx`, `camera.ts`) | One holder at a time: WF (reveal / load refits) first, then CB (turn highlight via the token overlays registry if possible) |
| Schema (`src/server/db/`) | Lanes with a fixed merge order: TT core (macros, roll requests, audio assets) first; CB core only if a manual order needs a column; SB none expected |
| Combat tracker rows / End | CB owns rows (drag reorder); SB's end-of-combat summary hooks End without editing rows; one holder of `lifecycle.ts` at a time (CB then SB, or per seams) |
| Dice tray / roll paths | TT owns (macros, roll requests); SB's luck tracker reads roll facts only |
| Notification kinds / views | Append-only registries (TT roll request, SB kill-feed / summary); toast policy per WF |
| Snapshot ceilings (CON-44) | DM 1.5 MiB, players 512 KiB (#256); measure macros, roll requests, audio asset rows, trophy / luck data; stats stay computed on request |
| Fixtures | Existing bundles keep behaving; session-sim-12 = session-sim-11 + sprint-8 units; state-changing e2e specs get their own alias bundles |

## Gates

1. **DM gate 1 (specs):** all four tracks reviewed; picks, scope, dependencies, ADRs, build order.
2. **Builds:** walkthrough PASS per slice; `check` + full `e2e` in the branch and on `main` after every merge; backlog items in idle slots (#286), not near the end.
3. **Sprint gate:** session-sim-12, "Playtest: sprint 8 features", recap.

## Expected DM questions (for the spec agents to frame, not to decide)

- Window frame: what "useful size" means per window (rows visible, attacks above the fold); whether the DM's Game log may shrink below its useful size before a launcher window is put away; what grows back after a resize up (only shell-shrunk windows, or also auto-minimised ones); whether tool-bar pushes may put a window away instead of covering a PC.
- Table tools: who can make macros (players for their PCs, the DM for anyone / monsters?) and where they live (sheet section, tray, a bar); macro syntax (dice notation only, or labelled parts / damage types); roll requests: to everyone / chosen PCs, skill / save / ability / custom, DC shown or hidden, results public or DM-only, a timeout; can a player decline; the pause screen's content (message, image, "back in 5 min" timer) and what players can still do (sheet? chat?); alert sounds: which events, per-campaign library, size limit, players' mute still wins.
- Stats tier B: kill-feed for every kill or only player kills; trophy case contents and who sees it; luck tracker public or private; end-of-combat summary automatic at End or on demand, and for players too.
- Combat polish: does a dragged order survive a new round / a new combatant; highlight style and whether hidden tokens ever highlight; party summary as a strip or a window, and what players see of each other (HP numbers vs bands for PCs).
