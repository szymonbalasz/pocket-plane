# Sprint 9: reminders + strongholds, Party Manager + window memory, fix pack, smaller picks

DM decision #338 (sprint-8 recap + sprint 9 scope). Process: [orchestrator prompt](orchestrator-prompt.md) (incl. **§3a backfill**), [continue-session §3](continue-session.md#3-herdr-how-to-run-agents-learned-the-hard-way) and its lessons (sprint 8's first). Sprint 8 for reference: [sprint-8](sprint-8.md) (same loop: specs in parallel → seams → reviews → one DM gate → builds per hotspot rules → walkthroughs → session-sim → playtest section → recap).

## Tracks

"sim-12" = the [session-sim-12 report](../../.verify/20261022-194052-session-sim-12/report.md) (local, gitignored; copy into each worktree) and the "Known gaps" of [Playtest: sprint 8 features](sprint-8.md#playtest-sprint-8-features).

| Track | What | Specs | New / revised | Prefix |
|---|---|---|---|---|
| **RS** reminders + strongholds | **BL-73** as the DM wrote it. **Reminders** (own concept): text + optional clickable rolls, aimed at the party or one character, optional source ("Axeholm: Baths"); no mechanics (roll changes stay with effects). A Party Manager **Reminders** tab (players: party + own characters; DM: all, grouped by character, party first) and a character-sheet section; per character a read-only block of active conditions / effects / concentration from combat, under existing visibility. **Strongholds**: a Party Manager **Strongholds** tab lists them; each opens a Stronghold window with **Staff** (name, role, wage, notes, optional "works in" facility), **Facilities** (planned / building / built / replaced, cost, build days, upkeep, income dice, effect text, current order, "replaces"), **Defenders** (count), linked **Reminders**, **Stores** (one per stronghold: a holder in the loot / inventory ledger, so Move to party is the existing form), **Notes**; any row DM-only. Removing a facility / stronghold removes its reminders (confirm). Not in: income report or automation, bastion turns, facility levels, events table. Borrows the 2024 bastion structure (staff per facility, orders, defenders), not its catalogue (licence check vs ADR-0018). Reference: Axeholm in the DM's campaign vault (`2. Entities/Quests/Axeholm Bastion.md`, `2. Entities/Items/Axeholm Upgrades.md`): the spec agent may skim copies the DM drops at `.verify/sprint9/axeholm/` as one example, but shouldn't take much stock in them (DM, 2026-10-22); BL-73 is the spec | new [reminders](../specs/reminders.md), new [strongholds](../specs/strongholds.md); [party-board](../specs/party-board.md) (tabs), [party-loot](../specs/party-loot.md) (Stores holder), [character-sheet-full](../specs/character-sheet-full.md) (Reminders section), [combat-extras](../specs/combat-extras.md) (effects read) | New + revise | REM, HOLD, PARTY, LOOT, CHARX |
| **PM** Party Manager + window memory | **Party Manager** (#338): the Party window and its launcher are renamed **Party Manager**; **Party status** becomes its **first** tab (the landing tab, ahead of Handouts); the separate `party.summary` window and its launcher button go; **Companions** leaves the tab bar and becomes a **section inside the Party status tab** (each owner's companions under their PC); default width **1.25×** (440 → 550 px). **Window memory** (#338, amends ADR-0060 / #333): the placer places only a window the user hasn't moved or resized yet, and again after Reset layout; once the user moves or resizes a window it always reopens at exactly that size and spot, even over other windows or PCs, only nudged back on-screen if it would fall off the edge; the most recently opened / touched window goes on top; nothing is shrunk or put away to make room for it; tool-bar pushes stay temporary. Supersedes BL-85. Frame follow-ups owned here (PM holds the frame): BL-82 (placer bench), BL-86 (DM zoom after a resize round trip), BL-87 (Game log shrinks for good), BL-80 (harness cells with Party status, DM launcher labels) | [play-shell](../specs/play-shell.md), [party-board](../specs/party-board.md), [scenes-map](../specs/scenes-map.md) (refits) | Revise | SHELL, PARTY, MAP |
| **FX** fix pack | sim-12 FAILs **BL-83** (DM toast stack leaves its home band over PCs) and **BL-84** (no DM kill-feed toast for hidden kills); glitches **BL-88** (card toast over the Notifications window's Apply), **BL-89** (a monster added mid-combat leaves its initiative popup over the map), **BL-90** (small items); **BL-91** (a stale client after a rebuild shows "Failed to fetch dynamically imported module" in a window instead of offering a reload); older small items **BL-54, -57, -62, -63, -68, -69 (fixture dates), -72, -74, -75, -76, -77, -79, -81**. Each item: fix (with an FR delta where behaviour changes) or drop with a reason | [notifications](../specs/notifications.md), [stats](../specs/stats.md), [dice-roll-log](../specs/dice-roll-log.md), [gems](../specs/gems.md), [live-sync](../specs/live-sync.md), [combat-extras](../specs/combat-extras.md), others per item | Revise | per spec |
| **SP** smaller picks | **Keyboard shortcuts + command palette** (Obsidian / VS Code style: search + commands in one palette, open windows, common actions; tier A–B), **rules quick reference** (a DM screen of rules lookups; tier B), **session recap** (an end-of-session summary from the event log and stats; tier B, from the campaign-manager stub) | [play-shell](../specs/play-shell.md) (shortcuts, palette), [compendium](../specs/compendium.md) or a new spec (rules reference), new `session-recap` or [campaign-manager](../specs/post-mvp/campaign-manager.md) promoted (recap), [stats](../specs/stats.md) (recap reads) | New + revise | SHELL, CMP, RECAP |

**Backlog for idle slots (DM #286 rule):** whatever fits §3a and isn't in the fix pack above.

**Not this sprint:** 5etools class import / levelling; **the UI / art sprint** (BL-29); world-builder (wikilinks, NPC directory, journal, map pins); agent / MCP API; single executable; Obsidian importer; DM homebrew file import; in-game calendar.

## Orchestrator: how to run this sprint

**Phase A: specs (one DM gate)**
1. Start **all four** spec agents at once: **RS**, **PM**, **FX**, **SP**. Copy inputs into each worktree (this file, the session-sim-12 evidence `.verify/20261022-194052-session-sim-12/`, the sprint-8 playtest section). Pre-assign new FR / OQ ID ranges per track in each brief for every shared spec (compute the current maxima first). RS: copy `.verify/sprint9/axeholm/` into its worktree if the DM put the notes there (light reference only); never search the DM's folders for them.
2. Each spec agent: options + bold pick per open question, a **measured** CON-44 figure for anything new in the snapshot or per-event traffic (heavy harness probe; DM ceiling 1.5 MiB, players 512 KiB, #256; last measured DM worst ≈ 1.15 MB with table tools at their caps), named tests, a §13 walkthrough, a build split with the shared files each slice touches, and the **dependency** it needs, if any, with alternatives (SP: fuzzy search for the palette — the shared matcher `@shared/search/match` first; none expected).
3. Settle seams yourself (one `seams.md`, copied into each worktree; authors push back once). Expected seams: **PM ↔ RS** (Party Manager's tab bar: Party status, Handouts, Loot, …, Reminders, Strongholds at 550 px — how many tabs fit, Strongholds as its own launcher window?; the Stronghold window under window memory), **PM ↔ FX** (frame vs toast runtime: PM holds the placer / frame files, FX the toast runtime for BL-83 / BL-88), **PM ↔ SP** (the palette is an overlay or a window; shortcuts that open windows; Reset layout as a command), **SP ↔ RS** (does the session recap list reminders / stronghold events?), **SP ↔ FX** (the recap reads stats; BL-84's feed fix), **RS ↔ FX** (the loot ledger holder vs BL items in party-loot, if any).
4. Reviews: **two** review agents in parallel (review-a: RS + SP; review-b: PM + FX), then `rulings.md`, authors apply.
5. **DM gate 1**: every pick that needs the DM, scope cuts per track, **new dependencies** (none expected), ADR acceptance (likely: window memory amending ADR-0060; reminders / strongholds as new record families; maybe the Stores holder in the loot ledger), build order. Integrate (number ADRs, index, glossary — Reminder, Stronghold, Facility, Staff, Defenders, Stores, Party Manager, Command palette —, registries in AGENTS §9.9, log) and merge the spec branches.

**Phase B: builds**
6. Cores first, one schema lane per conflict set (RS: reminders + strongholds tables, the Stores holder; SP: a recap record only if it can't be computed on read; PM / FX: none expected), then feature slices in parallel wherever the hotspot table allows. Stack a slice on an unmerged branch once that branch passed its walkthrough. Small slices in the same area go to one builder with one walkthrough (FX: group by area).
7. Every slice: builder → "ready for walkthrough" → test agent → fixes → `check` + full `e2e` in the branch after merging main → merge → `check` + full `e2e` on `main` (**never merge into `main` while its gates run**; never background with `&`). Run `resolve_docs.py` after every merge; regenerate `replay.failing.json` / goldens, never hand-merge them (sprint-8 lesson). **Don't rebuild `main`'s `dist/` while the DM may be testing on `main`** (a rebuild breaks their open page; ask first or run gates in a worktree). Backlog backfill when a slot is idle (DM #286), never ahead of an unblocked sprint slice; stop once the last sprint slices are in flight.
8. Sprint gate: session-sim-13 on final `main` (bundle = session-sim-12 + sprint-9 units; incl. Party Manager opening on Party status with Companions under owners at 550 px; windows reopening exactly where and how big the DM left them, most recent on top, Reset layout restoring defaults; reminders for the party and one character on the sheet and in Party Manager, a hidden reminder; a stronghold with staff, facilities, defenders, stores moved to the party, a DM-only row; the command palette and shortcuts; the rules quick reference; a session recap; every fix-pack item re-checked), leak scan per player, a "Playtest: sprint 9 features" section here, then **pause and recap with the DM**.

## Progress (updated as slices merge)

| Date | What |
|---|---|
| 2026-10-22 | Phase A started: spec agents RS, PM, FX, SP working in `spec/s9-{rs,pm,fx,sp}` (ID ranges from `ab10c460`, specs unchanged since; no Axeholm notes in `.verify/sprint9/`) |
| 2026-10-22 | Specs drafted; seams S1–S14 (`.verify/sprint9/seams.md`); reviews (RS + SP 1 blocker / 5 majors; PM + FX 0 / 5) ruled and applied. **DM gate 1** ready (`.verify/sprint9/gate.md`) |
| 2026-10-23 | **DM gate 1 passed (#339):** every pick, ADRs 0064–0068 accepted; specs merged and integrated (glossary, spec index, registries, backlog). Phase B wave 1 building: window memory (PM1), Party Manager (PM2), reminders + strongholds core (RS0), dice + gem line fixes (FX2) |
| 2026-10-23 | **Merged: reminders + strongholds core** (RS0: records, commands, Stores in the loot ledger, stronghold-index; walkthrough 23/23, leak scans clean, DM snapshot +2.9 KB). Recap builder (SP3) started |
| 2026-10-23 | **Merged: dice + gem line fixes** (FX2: keep-highest join, one-line copy, reroll line follows the card, one frame per gem spend, six quick awards = one line, roll popup never sticks, macro name error; walkthrough 10/10). Window memory (PM1) re-test 7/7, merging. Started stacked on it: toast stack + kill feed (FX1), command palette (SP1), rules reference (SP2); Party Manager (PM2) adds its shared rows |
| 2026-10-23 | **Merged: window memory** (PM1: moved / resized windows reopen exactly, newest on top, temporary tool-bar pushes, Reset forgets; Game log comes back, no DM zoom after a resize round trip, Scenes keeps its drop spot; re-test 7/7) and **connection + stale-page fixes** (FX3: offline chip in ~50 ms, silent link dropped in ~13 s with no false drops, "New version available — reload" in any window after a rebuild, campaign switcher ellipsis, End ends a summon-only concentration; 6/6). `main` green (flakes re-run alone) |
| 2026-10-23 | **Merged: command palette + shortcuts** (SP1: Ctrl+K, `?` sheet, window letters, DM N / Shift+N, single-key off switch; re-test 11/11) and **Party Manager** (PM2: renamed, Party status first, companions under their PC, 550 px, old layouts migrated, "Party status" command; re-test 5/5). Passed and queued: toast stack + kill feed (FX1 12/12), rules reference (SP2 14/14). Building: reminders UI (RS1, in walkthrough), strongholds UI (RS2), recap part 2 (SP3) |
| 2026-10-23 | **Merged: toast stack + kill feed** (FX1: the DM's toast stack stays in its column and off window title bars, cards fold into an open Notifications window, hidden kills reach the DM's feed, quiet stats retry, real dates on fixture fights; 12/12). Reminders UI (RS1) and Strongholds UI (RS2) passed; Stores UI (RS3) building |
| 2026-10-23 | **Merged: reminders UI** (RS1: Party Manager Reminders tab, the sheet's Reminders tab with a count, roll buttons like macros, read-only effects line; all PASS). Passed and queued: strongholds UI (RS2 11/11, wiring the reminder buttons), rules reference (SP2 16/16), Stores UI (RS3 18/18); recap re-test running |
| 2026-10-23 | **Merged: strongholds UI** (RS2: Strongholds tab, Stronghold window with Facilities, Staff, Reminders, Notes and Defenders, DM-only rows, income rolls, Add / Make reminder, the reminder source icon; 11/11 + re-test 5/5). Queued: rules reference (SP2 16/16), session recap (SP3 re-test 8/8), Stores UI (RS3 18/18) |
| 2026-10-23 | **Merged: Stronghold Stores** (RS3: Stores tab, Move to party / to a character from the existing form, per-item DM-only, loot log names the Stores, Inventory without Stores rows; 18/18). Track RS complete. Queued: rules reference (SP2), session recap (SP3) |
| 2026-10-23 | **Merged: rules quick reference** (SP2: a Rules window on both launchers with SRD 5.1 cards on curated pages, pins, DM house rules, CC BY attribution; palette rules search; 16/16). Last slice: session recap (SP3) |
| 2026-10-23 | **Merged: session recap** (SP3: on-demand recap of fights, party tally, loot, notable rolls and awards from the palette or the Stats Session tab; the DM's Share with a 280-char note and unticked sections opens it for everyone; Copy as Markdown; 8/8). **All sprint 9 slices on `main`.** Final gates + quiet bench, then session-sim-13 |
| 2026-10-23 | **Sprint gate:** final `main` check 5,530 / e2e 225 / bench 41 of 41; **session-sim-13 14 / 15 PASS** (FAIL e palette "cover" lands off the card → BL-98; stale-page step N/A by design), leak scan clean, hard kill byte-identical; sim-12 FAILs c and h fixed; glitches → BL-97–BL-104. "Playtest: sprint 9 features" written below. Next: recap with the DM |

## Playtest: sprint 9 features

Run from `C:\Repos\pocket-plane` on `main` (PowerShell). ~10–15 minutes per part. **DM** (normal browser) + **Player 1** (incognito: Mira and Brakka) + **Player 2** (another browser: Thorn). Regression run: [session-sim-13 report](../../.verify/20261023-193558-session-sim-13/report.md) (local, gitignored): **14 / 15 PASS** on final `main` (check 5,530, e2e 225, bench 41 / 41; the stale-page step N/A, verified in its branch), leak scan clean for both players, a hard kill mid-fight with a Stronghold window, Party Manager and an open Recap restarted byte-identical. Both sim-12 FAILs (DM toast stack over PCs, no DM callout for hidden kills) are fixed, and so are BL-86–BL-90. The one FAIL and the glitches are the known gaps below.

### Setup

```powershell
git pull; bun install
bun run build
bun run fixtures:reset-load session-sim-13 --profile verify
bun run start --profile verify
```

Open the printed DM URL (paste the secret) and each player link in its own browser. Town may be live at load: show Goblin Ambush from the Scenes window; close Player 1's presented-handout popup if it appears. `session-sim-13` = `session-sim-12` + Greystone Keep (a stronghold with facilities, staff, Stores, a DM-only vault and spy), a secret tower, party / character / DM-only reminders and Mira's Bless. Other bundles: `reminders-strongholds` (reminders + strongholds only, small), `sp-s9` (a recap with a loot haul), `sp-rules` (rule cards + a house rule), `pm-memory` (the window-memory set). To switch: `Ctrl+C`, `bun run fixtures:reset-load <bundle> --profile verify`, `bun run start --profile verify`; player links change on every load. Fixture fights now carry today's date (CLI loads use the load time, ADR-0068).

### Before you start: tips

- **Three browsers side by side.** Reminders, strongholds and the recap are mostly about who sees what: keep the DM, Player 1 and Player 2 visible together.
- **Window memory is per browser.** Once you drag or resize a window, it is "yours": it reopens exactly there, even over a PC. To get the old automatic placement back: **Preferences** (click your name chip) → **Layout** → **Reset layout**. Clicking a window only brings it to the front; it doesn't make it "yours".
- **Shortcuts don't fire while you type.** Click the map (or anywhere outside a text field) first. `Ctrl+K` works from anywhere, even inside a field.
- **Exact screen sizes.** F12 → device toolbar (Ctrl+Shift+M) → Responsive → width × height (1280×720, 1440×900).
- **Peek at a window's state (optional).** F12 → Elements → a window (`data-testid="ui-window"`): `data-remembered` = you moved / resized it; `data-placed` = why it sits there (`stored`, `auto`, `zone`, `pushed`, `squeezed`…); `data-z` = stacking order.

### Where to find each new thing

| Feature | Who | Where to click | What to look for |
|---|---|---|---|
| **Party Manager** | both | Launcher **Party Manager** (was "Party"; the separate Party status button is gone) | Opens on **Party status**: PCs' HP / temp / AC, each owner's companions indented under their PC. Tabs Party status · Handouts · Inventory · Loot · Reminders · Strongholds (the strip scrolls when narrow). It remembers the last tab |
| **Window memory** | both | Drag or resize any window | It reopens exactly there and that size, on top, even after a reload or a screen-size change (only nudged back on-screen). Tool bars push it aside only while the tool is open. **Preferences → Layout → Reset layout** forgets every window |
| **Reminders** | both | **Party Manager → Reminders**, or a sheet → tab **Reminders** (a count badge) | Rows grouped Party, then each character; optional source ("Greystone Keep: Forge Hall") and roll buttons (Shift / Ctrl / Alt like macros); **Add reminder**. Players add on the party and their own characters and edit only their own; your "DM only" reminders never reach them. A read-only line shows a character's conditions / effects / concentration |
| **Strongholds** | both | **Party Manager → Strongholds** → a stronghold | The **Stronghold** window: Defenders in the header; tabs Facilities (state, cost, build days, upkeep, income dice button, effect, order, "replaces"), Staff, Stores, Reminders, Notes. Any row can be **DM only** (eye-off). A new stronghold is DM-only until you show it. Facility menu → **Make reminder**; removing a facility asks before removing its reminders |
| **Stores** | both | Stronghold window → **Stores** | Coin and items of that stronghold; **Move to party** / to a character uses the usual Move form. Single items can be DM-only. Players see moves to / from a hidden Stores as "Outside the party". Deleting a stronghold moves its Stores to the party (the confirm says what) |
| **Command palette** | both | `Ctrl+K`, or the search button in the top bar | One list: Commands, Windows, Characters, Creatures (DM), Rules, Compendium. `>` = commands only, `@` = characters. Try "init", "> reset", "@mira", "cover", "recap", "party status" |
| **Shortcuts** | both | Press `?` (outside a text field) | The shortcuts sheet. `/` = roll bar; letters open / close windows (L Game log, I Initiative, D Dice tray, C your character's sheet, B Compendium, R Rules, P Party Manager, S Stats); DM: `N` next turn, `Shift+N` previous. **Preferences → Keyboard → Single-key shortcuts** turns the letters off |
| **Rules** | both | Launcher **Rules** (or palette "cover", or Compendium → a rule → **Open in Rules**) | Pages Combat · Conditions · Checks · Exploration · Spellcasting · Hazards · House rules · Pinned; SRD 5.1 cards, wording unchanged, "SRD 5.1" on each; pin ☆ → **Pinned** (per browser); your house rules (Compendium → New → rule) on **House rules**, DM-only ones only for you; footer **About** = the licence line |
| **Session recap** | both | Palette "Session recap", or **Stats → Session** tab → **Recap** | Fights (kills / downs / MVP), party tally, loot, notable nat 20 / nat 1 rolls, awards, per session (picker). You: **Share** (a note up to 280 characters, untick sections) opens it for everyone; **Copy as Markdown** |
| **Toast stack (DM)** | DM | Several pending damage cards | Stays in its column near the top centre, never on the map's left edge over PCs, never on a window's title bar; with the **Notifications** window open, card toasts fold into it |
| **Kill feed (DM)** | DM | Kill a hidden monster | "Wolf falls (hidden)" / "Overkill! … (hidden)" toasts for you only |
| **Stale page after an update** | both | Keep a page open while `main` is rebuilt, then open a window | "New version available — reload" with a Reload button inside the window instead of an error |
| **Gem awards** | DM | Click a gem **+** several times quickly | One line "DM awards Brakka 6 Fortune gems" instead of six |

### Part 1: Party Manager + window memory (`session-sim-13`)

| # | You do | Expect |
|---|---|---|
| 1 | Player 1 and Player 2: launcher **Party Manager** | Opens on Party status, about 550 px wide (narrower at 1280×720 if needed); companions under their owner; Player 2 doesn't see Player 1's hidden pet |
| 2 | You: drag the Compendium onto Mira and make it bigger; close it; reopen it; reload | Exactly the same spot and size each time, on top |
| 3 | Resize the browser 1440×900 → 1280×720 → 1440×900 | The Compendium is nudged on-screen at 1280 and back exactly at 1440; the map is at its normal Fit each time (no stuck zoom) |
| 4 | Pick the Fog tool with the Compendium under its bar; close the tool | Pushed off the bar while Fog is open, back exactly after |
| 5 | Open Party Manager (not moved yet) so the Game log shrinks; close it | The Game log grows back to full size |
| 6 | **Preferences → Layout → Reset layout** | Everything back to the starting layout; reopened windows are placed automatically again |

### Part 2: reminders + strongholds (`session-sim-13`)

| # | You do | Expect |
|---|---|---|
| 1 | **Party Manager → Reminders** on all three | You: Party, Mira, Thorn incl. a "DM only" row. Player 1: Party + Mira only. Player 2: Party + Thorn only |
| 2 | Player 1: click Mira's "Charm" roll | A normal roll "Mira — Charm" in the Game log |
| 3 | Player 2: **Add reminder** on Thorn; edit it; you mark it **DM only** | Player 2 sees it and can edit it; after your change it leaves Player 2's list |
| 4 | **Party Manager → Strongholds → Greystone Keep** on all three | You: 6 facilities incl. the vault (eye-off), staff incl. the spy; players: no vault, no spy, "Wages 3 gp" |
| 5 | Player 1: Forge Hall **Income 2d6**; you change Forge Hall's order, then the vault's effect | A roll in the log; players see the new order; the vault edit sends players nothing |
| 6 | Player 1: Stores → **Move to party** 50 gp; take Arrows ×20 to Mira | Party pot +50 gp, Mira has the arrows, log rows name "Greystone Keep Stores" |
| 7 | You: remove the Steam Rooms facility | The confirm says "Its 1 reminder is removed too."; the reminder leaves every Reminders tab |
| 8 | Show the secret tower to players, then hide it again | It appears for them, then disappears; their ledger rows read "Outside the party" |

### Part 3: palette, shortcuts, rules, recap (`session-sim-13`)

| # | You do | Expect |
|---|---|---|
| 1 | Click the map, `Ctrl+K`, type "init", Enter; then "> reset"; then "@mira" | Initiative to the front; Reset layout runs; Mira's sheet opens |
| 2 | Click the map; press `L`, `I`, `R`, `P`, then each again; `N`, `Shift+N` | Windows open / come forward, then minimise; the turn moves on and back for everyone |
| 3 | Type "n" in the roll bar; press `?` | No turn change while typing; the shortcuts sheet (players don't see N / Shift+N) |
| 4 | `Ctrl+K` "cover" → Enter; pin Cover; reload | The Rules window on the Cover card; Cover on the Pinned page after the reload |
| 5 | Player 1: Rules → House rules | Your shared house rule only, not the DM-only one |
| 6 | **Stats → Session → Recap**; then **Share** with a note, unticking Notable rolls | The recap opens for both players with your note and without notable rolls; fight labels show today's date |
| 7 | Kill a monster and add 10 gp loot with the Recap open | The open recap updates within a few seconds; the session picker still shows the right session |

### Part 4: fix pack re-checks (`session-sim-13`)

| # | You do | Expect |
|---|---|---|
| 1 | DM 1280×720, Game log + Initiative + 4 pending cards; drag Scenes to the top centre | The toast stack stays in its column, not at the left edge over Mira |
| 2 | Open the Notifications window with a card pending | No card toast over the window; its Apply buttons work |
| 3 | Kill the hidden Wolf with your own damage | "Wolf falls (hidden)" for you within a second; nothing for players |
| 4 | Add a monster mid-combat (Initiative → Add…) | Its initiative popup closes by itself after a few seconds |
| 5 | Player 1: tray "4d6kh3"; copy a log line and paste it | "5 3̶ + 6 + 6" style line; the paste is one line |
| 6 | Give Brakka 6 Fortune gems with quick clicks | One log line for all six |
| 7 | Player 2 goes offline (Wi-Fi off or DevTools → Network → Offline) | Their chip flips to "Reconnecting…" within about a second, back on reconnect |
| 8 | End the Escort fight with Thorn's elementals | The elementals go and Thorn's "Concentrating" chip goes with them; Mira's Bless stays |

### Known gaps

- **Palette "cover" lands off the card** (sim-13 FAIL e, BL-98): the Rules window opens on the right page, but scrolled to its top (or, if already open, to the card's end). Scroll to the card.
- **Add… with "Add hidden" on an existing visible token joins it public** (BL-97): its name shows in players' hit lines. Until fixed, hide the token first, or add the creature without binding.
- **Party Manager and the Stronghold window put each other away** on the DM at 1440×900; players at 1280×720 keep one of Recap / Stats / Party Manager / Rules open (BL-99). Drag one of them once and both stay.
- **The DM map jumps to a corner after a reload** when a window you placed covers the map centre (BL-100): move the window or press Fit.
- **DM toasts can still cover some window parts** (Scenes list, Rules tabs, the Start dialog title) (BL-101).
- **Rules cards show raw markup** for some links ("srd:prone") and ">" in indented quotes (BL-102).
- **Players' "Biggest overkill"** shows the hit's damage, not the overkill (BL-103).
- Smaller: an unmarked DM-only house rule in the collapsed list, recap refresh ~2 s, the remove-facility confirm repeats its title, the DM's Party Manager opens narrower than players', sounds need one click after a load (BL-104).
- Layout harness: Party Manager at 550 px and the three new windows added named exemptions (BL-93); the roll-popup e2e flakes under load (BL-95).

## Check `main` any time (DM)

Bundle **`session-sim-13`** (sprint 9 gate).

```powershell
git pull; bun install
bun run build
bun run fixtures:reset-load session-sim-13 --profile verify
bun run start --profile verify
```

## Boundaries and hotspots (sequence these)

| Overlap | Rule |
|---|---|
| Play-shell frame (`placer.ts`, `manager.ts`, `placement.ts`, `storage.ts`, `shell-store.ts`, `ShellWindow.tsx`, keep-outs, size table, goldens, replay harness) | **PM owns** all sprint (window memory, BL-82 / -86 / -87 / -80); others register through registries (append) after PM's frame core |
| Party Manager (`party-board` window, tabs, `Board.tsx`, `Summary.tsx`, `Companions.tsx`) | PM's restructure first (rename, Status tab, Companions section, width); RS adds the Reminders / Strongholds tabs after it (append to the tab list or per seams) |
| Toast runtime (`ToastRuntime.tsx`, notifications keep-out) | **FX** (BL-83, BL-88); PM doesn't touch it |
| Schema (`src/server/db/`) | RS core first (reminders, strongholds, the Stores holder); SP only if the recap needs a record; FX / PM none expected |
| Loot ledger (`party-loot`) | RS (Stores holder) only; FX items in party-loot, if any, after RS core |
| Stats read models | SP (recap) reads; FX (BL-84, BL-74) owns stats fixes; one holder of `stats` client files at a time |
| Character sheet sections | Append-only `sheet-sections.ts` (RS Reminders section) |
| Snapshot ceilings (CON-44) | DM 1.5 MiB, players 512 KiB (#256); measure reminders, strongholds, recap rows; ≈ 1.15 MB DM worst today |
| Fixtures | Existing bundles keep behaving; session-sim-13 = session-sim-12 + sprint-9 units; state-changing e2e specs get their own alias bundles |

## Gates

1. **DM gate 1 (specs):** all four tracks reviewed; picks, scope, dependencies, ADRs, build order.
2. **Builds:** walkthrough PASS per slice; `check` + full `e2e` in the branch and on `main` after every merge; backlog items in idle slots (#286), not near the end.
3. **Sprint gate:** session-sim-13, "Playtest: sprint 9 features", recap.

## Expected DM questions (for the spec agents to frame, not to decide)

- Reminders: who can add them (players for their own characters / the party?), edit / delete rights, can a reminder be hidden from players, does a roll in a reminder use macros' roll path, ordering, "done" / dismiss vs permanent.
- Strongholds: several per campaign; who sees what by default (players see the stronghold, staff, facilities?), wages / upkeep as plain numbers or tied to the loot ledger's coins, facility order text free or from a list, Stores capacity, Strongholds as a Party Manager tab or its own launcher window.
- Party Manager: tab order after Party status; what players see vs the DM in each tab; the window's width at 1280×720 (550 px vs the band).
- Window memory: what happens to a remembered window after a smaller screen (shrink to fit vs keep size and nudge); does "touched" include a plain click / focus or only move / resize; whether tool-bar pushes may still move a remembered window.
- Command palette: keyboard shortcut to open it, what it searches (windows, compendium, characters, commands), player palette vs DM palette.
- Rules quick reference: source (SRD content we already ship vs curated pages), a window vs the compendium, licence (ADR-0018).
- Session recap: automatic at session end or on demand, who sees it, what it lists (kills, loot, XP?, reminders, notable rolls), editable by the DM before sharing.
