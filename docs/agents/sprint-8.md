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
| 2026-10-22 | **WF2 merged** (tool-bar pushes through the ladder: no window over Mira when Fog opens (BL-61), drag under a bar pushed (BL-52), rail inset (BL-53); 13 / 14). Main after WF4 + WF2: check 5014 / e2e 199. **WF3 merged** (map refits: no zoom-in on reveal (BL-65), one fit path, 4-px PC margin, players' map yields, L3 put-away before below-useful; harness failing cells 307 → 19). CB2 turn ring started (last sprint slice); backlog picking stops |
| 2026-10-22 | Main after WF3: check 5029 / e2e 200. **TT1+TT2 merged** (saved macros on the sheet and tray, DM roll requests: prompts naming the PC, hidden / public answers, decline, Requests window with Roll for missing, prompts back after reload; walkthroughs 13 / 13 + 6 / 6). Main after TT1+TT2: check 5081 / e2e 202. SB1+SB2 (12 / 13 → fixed), CB3 (hidden companion fixed) and TT4 finishing; CB2 turn ring in gates |
| 2026-10-22 | **CB3 merged** (Party status window for both clients: PCs' HP, temp HP, AC live per ADR-0063, companions under owners, hidden companions never listed for other players; 6-PC layout at 1280×720). Main after CB3: check 5093 / e2e 203. CB2 turn ring walkthrough 16 / 16 |
| 2026-10-22 | **SB1+SB2 merged** (kill-feed callouts batched per hit, Highlights + End summary opening Stats on the fight, Luck tab, Trophies sheet tab, Kill feed preference; BL-69 default fight, BL-71). **CB2 merged** (current-turn ring for everyone who may know the turn; dashed for hidden on the DM; 16 / 16). TT4 pause screen (last slice) adding its stats hooks. Main after SB1+SB2 + CB2: check 5141 / e2e 205 |
| 2026-10-22 | **TT4 merged** (pause / intermission screen: full-screen card with message, image, back-in countdown; every input blocked incl. popups; requests, dice, toasts, kill feed, summary and refits held until resume; one sound at resume; survives reconnect and restart; walkthroughs 13 / 14 → fixed, final 9 / 9). **All sprint-8 slices merged** |
| 2026-10-22 | Main with every slice: check 5164 / e2e 206. Quiet-machine bench: 38 / 39 gates (placer settle 24–27 ms vs 25 ms → BL-82). **Sprint gate:** session-sim-12 started on final `main` |
| 2026-10-22 | **Sprint gate:** session-sim-12 **14 / 16 PASS** on final `main` (leak scan clean incl. macros, requests, hidden answers, sounds, initiative numbers, Party status, kills, trophies, luck; hard kill while paused with a request open restarted byte-identical). sim-11 FAILs g and h **fixed**; BL-66, BL-69 (default fight), BL-70, BL-71 fixed. FAILs → BL-83 (DM toast stack leaves its home band over PCs), BL-84 (no DM kill-feed toast for hidden kills); glitches → BL-85–BL-90. [Playtest: sprint 8 features](#playtest-sprint-8-features) written. Paused for the recap |


## Playtest: sprint 8 features

Run from `C:\Repos\pocket-plane` on `main` (PowerShell). ~10–15 minutes per part. **DM** (normal browser) + **Player 1** (incognito: Mira and Brakka) + **Player 2** (another browser: Thorn). Regression run: [session-sim-12 report](../../.verify/20261022-194052-session-sim-12/report.md) (local, gitignored): **14 / 16 PASS** on final `main` (check 5,164, e2e 206), leak scan clean for both players, a hard kill while paused with a request open restarted byte-identical. Both sim-11 FAILs (windows on Mira at 1280×720, the players' reveal refit with the companion card) are fixed. The two new FAILs are the first known gaps below.

### Setup

```powershell
git pull; bun install
bun run build
bun run fixtures:reset-load session-sim-12 --profile verify
bun run start --profile verify
```

Open the printed DM URL (paste the secret) and each player link in its own browser. Town may be live at load: show Goblin Ambush from the Scenes window; close Player 1's presented-handout popup if it appears. Other bundles: `table-tools` (macros, an open roll request, the Chime sound picked), `table-tools-paused` (the table starts paused), `stats-b` (a fight with known kill / luck numbers), `combat-polish` (ties, a fogged Goblin, Party status values), `wf-frame` (the window walkthrough set). To switch: `Ctrl+C`, `bun run fixtures:reset-load <bundle> --profile verify`, `bun run start --profile verify`; player links change on every load.

### Part 1: windows (`session-sim-12`)

| # | You do | Expect |
|---|---|---|
| 1 | Browser at 1280×720, Game log + Initiative open; open Compendium, Party, Encounters, Stats | None lands on Mira, Brakka or Thorn (a 4-px gap); each opens at a readable size, or the least recently used launcher window is put away first |
| 2 | Resize to 1440×900, then back to 1280×720, then 1440×900 | Windows come back to the same places and sizes (Game log 1150×240 at 1440) |
| 3 | Pick the Fog tool, drag a window under its bar, then close the tool | Windows are pushed off the bar (never onto a PC) and go back when the tool closes; every Fog control is clickable |
| 4 | Drag a window onto Mira yourself, close it, reopen it | It stays where you put it |
| 5 | Player 1 at 1280×720: open the Owlbear's card, then you **Reveal all** | Player 1's map zooms *out* (never in) so no newly revealed token sits under the sheet; same after a reload |
| 6 | Several pending damage cards at once; an error while a dialog is open | At most 3 toasts + "+N more"; errors stay readable above dialogs; the stack goes back home after a tool closes |

### Part 2: table tools (`session-sim-12`, or `table-tools`)

| # | You do | Expect |
|---|---|---|
| 1 | Player 1: Mira's sheet → **Macros** tab → Sneak Attack (enter physical dice 3, 4, 5) | "Mira — Sneak Attack: 3 + 4 + 5 = 12 physical" for everyone; no damage card. Player 2 can't edit your DM macro on Thorn |
| 2 | Player 1: dice tray `1d20+2` → **Save as macro** | It appears under Mira; Player 2 sees nothing |
| 3 | Game log roll bar → Options → **Request…**: All PCs, Perception, hidden | Each player gets a prompt naming the PC ("DM: Perception · Mira"); answers show only to you and that player; one sound per player |
| 4 | Request "Mira: DEX save", DC 15 shown, public; Player 2 **Declines** another; your **Requests** window → **Roll for missing** | Your window shows ✓ / ✗ / Declined per PC; Player 1 reloads with a prompt open → it comes back quietly |
| 5 | Top bar **Pause** → message, image, back in 5 min | Players get the full-screen card + countdown + sound; nothing behind it reacts (keys, wheel, drags, popups); you keep working; Preview shows you their card |
| 6 | While paused: send a request, kill a monster, End a fight; then **Resume** | Players see none of it until Resume; then exactly one sound, the prompt, the fight summary |
| 7 | Players window → Options → **Alert sounds**: pick the Chime for "turn"; try a too-big or too-long file | The Chime plays for Player 1 on Mira's turn (not if muted); too-big / too-long files are refused inline |

### Part 3: stats (`session-sim-12`, or `stats-b`)

| # | You do | Expect |
|---|---|---|
| 1 | Kill a monster; hit two monsters with one card | One toast per hit ("Thorn finished Goblin 4", yours adds the overkill); players never see amounts or hidden names |
| 2 | **End** the fight | A "Fight summary" toast and Stats opens on that fight with Highlights for everyone (players: public facts only; you also see Still standing) |
| 3 | Stats → **Luck** (session and Campaign) | Rolls, d20s, average, nat 20s / 1s per character; "DM dice" only for you |
| 4 | Player 1: Mira's sheet → **Trophies** | Lifetime totals + records; Player 2 has no Trophies tab on Mira |
| 5 | Player 2: Preferences → Stats → Kill feed off | No kill toasts for Player 2 |

### Part 4: combat polish (`session-sim-12`, or `combat-polish`)

| # | You do | Expect |
|---|---|---|
| 1 | Initiative: drag a row by its grip inside a tie, then across numbers; row menu → Move up / down | The order sticks through rounds; players never see a monster's or a hidden creature's number; a hint if a move skips or repeats a turn |
| 2 | **Next** through a round | A ring on the current turn's token for everyone who may know the turn; hidden / fogged combatants: a dashed ring only for you |
| 3 | Players: launcher → **Party status** | Each PC's HP, temp HP and AC live (companions under their owners); no monsters; a hidden companion isn't listed for others |

### Known gaps / later

- **The DM toast stack can leave its home band (FAIL c):** at 1280×720 with Scenes moved it sat at the left edge over Mira; at 1440×900 with Fog open it slid over the party (BL-83).
- **No DM kill-feed toast for hidden kills (FAIL h):** public kills toast, hidden ones only show in Highlights (BL-84).
- A window put away to make room doesn't come back when the other one closes (BL-85); after 1280 → 1440 → 1280 the DM map stays zoomed in (BL-86); opening Party status or a sheet at 1440 shrinks the Game log for good (BL-87); a card toast can cover the Notifications window's Apply (BL-88); a monster added mid-combat leaves its initiative popup over the map (BL-89); small ones in BL-90.
- Today's fight still reads "Thu 1 Jan" with a huge duration (fixture clock, BL-69's other half).
- The placer's speed check sits right at its 25 ms limit (BL-82).
- Other players can see a draft PC in Party status (BL-79); the DM launcher shows full labels only from 1920 px wide (BL-80).

## Check `main` any time (DM)

Bundle **`session-sim-12`** (sprint 8).

```powershell
git pull; bun install
bun run build
bun run fixtures:reset-load session-sim-12 --profile verify
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
