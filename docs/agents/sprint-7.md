# Sprint 7: gems, stats, sprint-6 follow-ups

DM decisions #310 (sprint-6 recap: windows park instead of covering a PC; a charmed companion keeps its token and loses its owner), #311 (sprint 7 scope). Process: [orchestrator prompt](orchestrator-prompt.md) (incl. **§3a backfill**), [continue-session §3](continue-session.md#3-herdr-how-to-run-agents-learned-the-hard-way) and its lessons (sprint 6's first). Sprint 6 for reference: [sprint-6](sprint-6.md) (same loop: specs in parallel → seams → reviews → one DM gate → builds per hotspot rules → walkthroughs → session-sim → playtest section → recap).

## Tracks

"sim-10" = the [session-sim-10 report](../../.verify/20261020-181950-session-sim-10/report.md) (local, gitignored; copy into each worktree) and the "Known gaps" of [Playtest: sprint 6 features](sprint-6.md#playtest-sprint-6-features).

| Track | What | Specs | New / revised | Prefix |
|---|---|---|---|---|
| **GM** homebrew gems | **An optional feature, disabled by default** ([#312](../decisions-log.md)): a per-campaign switch the DM turns on; while off, no gem UI, counts, spend actions or log lines anywhere (players and DM), and nothing gem-related in snapshots. The DM's gem rule ([#140](../decisions-log.md), [gems stub](../specs/gems.md)): the DM **awards / removes** gems per character (Inspiration, Fortune, Combat, Divine Knowledge, Action; max 5 held is a loose table rule, shown, not enforced); the player **spends** one → a game-log line. **Inspiration**: reroll any one d20 roll from the log after seeing it, the new roll replaces the old (old stays visible, struck through). **Combat**: before the DM applies a damage card, the player sets 1 damage die to max (2 at level 6, 3 at level 12); the card total updates server-side. Fortune, Divine Knowledge, Action: spend + log line only (the effect happens at the table). Gem counts on the character sheet; how they look (built-in icons now; art comes with the UI sprint) | **new** [gems](../specs/gems.md) (promote the stub), [dice-roll-log](../specs/dice-roll-log.md) (reroll supersede), [combat-tracker](../specs/combat-tracker.md) (max dice on a pending card, incl. late damage / Apply hit), [character-sheet-full](../specs/character-sheet-full.md) (gem block) | New + revise | GEM, DICE, CBT, CHARX |
| **ST** stats | Tier A of [stats](../specs/stats.md): a **live damage leaderboard** (who dealt / took / healed what this fight) and **overkill callouts** ("100 damage on a 20 HP goblin"), and **session awards** BG2-style (biggest hit, most damage taken, most healing, kills, nat 20s / nat 1s, times downed). Computed from the append-only event log (ADR-0016), so they work on past sessions; respect visibility (hidden DM rolls and hidden monsters never leak through stats); a session boundary per [ADR-0013](../architecture/adr/0013-session-journal-scope.md) | **new** [stats](../specs/stats.md) (promote the stub), [combat-tracker](../specs/combat-tracker.md) (damage / heal facts as read), [dice-roll-log](../specs/dice-roll-log.md) (roll facts), [play-shell](../specs/play-shell.md) (a Stats window / awards screen registration) | New + revise | STATS, CBT, DICE, SHELL |
| **FU** sprint-6 follow-ups + leftovers | **#310 → A**: when no spot is clear of both windows and PCs, park the oldest launcher window instead of covering a PC (amends #292; protected default-open windows unchanged; includes a player's Reset layout putting Compendium / the companion card over a PC). sim-10 FAIL a: the **drake's paw marker** disappears after End → Start. sim-10 FAIL b: Player 1's **sheet covers newly revealed tokens while the companion card is open** (no reveal refit). **BL-56** a one-row companion line in the DM's Initiative. Concentration: the "Concentrating: Conjure…" chip is cut text and does nothing on click; End doesn't warn that summon tokens will go; a hostile summon's token stays after End. The encounter editor's rows show no creature names in its 320-px window and its body is cut; Creatures names cut ("Fire Elem…"); the companion card opens at its minimum with attacks below the fold; the DM's map jumps at Start (Thorn under the Game log) and Fit with Scenes + a toast open drops to 24 px; the pending toast covers the Scenes window's first row while windows are pushed; a player's Reset layout shrinks Initiative to 2 rows; pushed windows stay pushed after the tool closes. **Leftovers from sprint 6's backlog list (DM):** **BL-46** a downed monster is back at full HP when bound into the next encounter (decide the binding rule), **BL-48** the small copy / UI list. Plus **BL-37** (Space doesn't press buttons; Tooltips on keyboard focus) | [play-shell](../specs/play-shell.md) (parking rule, Reset layout, pushed windows), [scenes-map](../specs/scenes-map.md) (marker, reveal refit with the card open, map jump at Start, Fit with Scenes), [combat-tracker](../specs/combat-tracker.md) (compact line, End dialog, hostile summon token, encounter editor, BL-46 binding), [combat-extras](../specs/combat-extras.md) (concentration chip), [character-sheet-full](../specs/character-sheet-full.md) (card size), [notifications](../specs/notifications.md) (toast vs pushed Scenes), entities (Creatures names), BL-48's specs | Revise | SHELL, MAP, CBT, CBTX, CHARX, NOTE, ENT |

**Backlog for idle slots (DM #286 rule: pull stories when agents idle):** BL-49 (asset library size warning), BL-50 (weapon-combat nat-1 e2e flake), BL-52 (window dragged under a shown tool bar), BL-53 (tool rail overlaps windows at 320 px), BL-54 (offline "Connected" chip lag), BL-55 (fog log spam with > 4 owned tokens), BL-13, BL-14; whatever else fits §3a.

**Not this sprint:** 5etools class import / levelling; world-builder (wikilinks, NPC directory); pause screen + saved macros; **the UI / art sprint** (BL-29: concept art first, its own slower sprint near the end — gem art waits for it).

## Orchestrator: how to run this sprint

**Phase A: specs (one DM gate)**
1. Start **all three** spec agents at once: **GM** (promotes `post-mvp/gems.md` to `docs/specs/gems.md`), **ST** (promotes `post-mvp/stats.md` to `docs/specs/stats.md`), **FU**. Copy inputs into each worktree (this file, the session-sim-10 evidence `.verify/20261020-181950-session-sim-10/`, the sprint-6 playtest section). Pre-assign new FR / OQ ID ranges per track in each brief for every shared spec (compute the current maxima first).
2. Each spec agent: options + bold pick per open question, a **measured** CON-44 figure for anything new in the snapshot or per-event traffic (heavy harness probe; DM ceiling 1.5 MiB, players 512 KiB, #256; last measured DM worst ≈ 870 KB), named tests, a §13 walkthrough, a build split with the shared files each slice touches, and the **dependency** it needs, if any, with alternatives.
3. Settle seams yourself (one `seams.md`, copied into each worktree; authors push back once). Expected seams: **GM feature flag** (where campaign-level feature switches live — a field on the campaign record vs a generic `features` map that later optional features reuse; likely a small proposed ADR), **GM ↔ ST** (a reroll superseding a log entry and a maxed die: what stats count — the final roll, the applied damage), **GM ↔ FU** (both in the combat apply popup / damage card: the Combat gem's max-dice step vs FU's End dialog and concentration changes), **ST ↔ FU** (a Stats window vs the parking rule and default sizes), **ST ↔ combat-tracker facts** (what "dealt" means with manual overrides, Apply hit and late damage, overkill raw vs applied).
4. Reviews: **two** review agents in parallel (review-a: GM + ST; review-b: FU), then `rulings.md`, authors apply.
5. **DM gate 1**: every pick that needs the DM, scope cuts per track, **new dependencies** (none expected), ADR acceptance (likely: stats as read-models over the event log; a log entry superseded by a reroll — check ADR-0016 / ADR-0021), build order. Integrate (number ADRs, index, glossary, registries in AGENTS §9.9, log) and merge the spec branches.

**Phase B: builds**
6. Cores first, one schema lane per conflict set (gems: counts + reroll link; stats: projections only if the spec picks materialised), then feature slices in parallel wherever the hotspot table allows. Small slices in the same area go to one builder with one walkthrough (sprint-6 lesson).
7. Every slice: builder → "ready for walkthrough" → test agent → fixes → `check` + full `e2e` in the branch after merging main → merge → `check` + full `e2e` on `main` (**never merge into `main` while its gates run**). Run `resolve_docs.py` after every merge (duplicate-number warning). Backlog backfill when a slot is idle (DM #286), never ahead of an unblocked sprint slice; stop once the last sprint slices are in flight.
8. Sprint gate: session-sim-11 on final `main` (bundle = session-sim-10 + sprint-7 units; incl. gems off by default (no gem UI for anyone), the DM switching gems on, the DM awarding gems, an Inspiration reroll (old roll struck through), a Combat gem maxing a die before Apply (late damage too), Fortune / Action spends logged, the damage leaderboard during a fight with an overkill callout, session awards at the end, a hidden DM roll / hidden monster never showing in stats, windows parking instead of covering PCs at 1280×720 / 1440×900, the drake marker after End → Start, a player's sheet clear of revealed tokens with the companion card open, the one-row companion line, the concentration chip, BL-46's binding rule), leak scan per player, a "Playtest: sprint 7 features" section here, then **pause and recap with the DM**.

## Progress (updated as slices merge)

| Date | What |
|---|---|
| 2026-10-20 | Phase A started: spec agents for gems, stats and the sprint-6 follow-ups running in parallel |
| 2026-10-20 | Specs drafted (gems, stats, follow-ups); seams ruled; reviews running. Backfill: weapon-combat natural-1 e2e flake fixed (BL-50, #313) |
| 2026-10-20 | Reviews ruled and applied (4 blockers fixed: gem spend lines and stats no longer leak hidden rolls / monster HP / fight names; Space-pan kept). **DM gate 1 open** (`.verify/sprint7/gate.md`). Backfill: DM image library size warning (BL-49, #314) |
| 2026-10-20 | **Gate 1 passed (#315)**: all picks, except the max-5 rule is a plain label. ADR-0058 (feature switches), ADR-0059 (stats read models). Backfill: fog log spam (BL-55, #316). `session-sim-11` bundle created. **Phase B wave 1 building:** gems core, window frame, combat follow-ups, small copy fixes |
| 2026-10-21 | **Gems core merged** (#317): per-campaign gems switch (off by default), gem counts, award / remove, plain spends; nothing gem-related reaches anyone while off. Inspiration reroll and stats core building |
| 2026-10-21 | **Combat follow-ups merged** (#320): a downed monster keeps its HP into the next fight, End removes summon tokens (hostile too) and says so, one-row companion line, concentration chip menu, encounter editor names, the drake keeps its paw through End. Window frame in fixes (toast vs pushed Scenes), small copy fixes in gates, gems sheet UI building |
| 2026-10-21 | **Small copy fixes merged** (#321, BL-48): "Added" confirmation, "Party inventory" toasts, roll bar names the sheet's character, clean dice-line spacing, Rage count once, typed Sneak Attack lines, kept Loot drafts. Window frame walkthrough passed after a toast fix; gems sheet UI in walkthrough |
| 2026-10-21 | **Gems sheet UI merged** (#322): gem block on the sheet, ± and Spend, Players-window counts, Campaign options switch. **Window frame merged** (#323): windows put away instead of covering a PC, readable sizes, pushed windows return, Space / Tab keyboard. Inspiration reroll passed its walkthrough (gates next); stats core fixed; Stats window and map follow-ups building |
| 2026-10-21 | Paused and resumed by the DM. **Inspiration reroll merged** (#325): reroll your own d20, old roll struck, attack cards follow, hidden rolls stay hidden. **Map follow-ups merged** (#326): no jump at Start, players' map refits with the card open, readable Fit with toasts, the paw always drawn. Backfill: Add hidden unticked without tokens (BL-58, #324). Stats window walkthrough 7 / 7; stats core merging the reroll; Combat gem building |

## Check `main` any time (DM)

Bundle **`session-sim-10`** until the sprint adds `session-sim-11`.

```powershell
git pull; bun install
bun run build
bun run fixtures:reset-load session-sim-10 --profile verify
bun run start --profile verify
```

## Boundaries and hotspots (sequence these)

| Overlap | Rule |
|---|---|
| Schema (`src/server/db/`) | Lanes with a fixed merge order: GM core (the campaign's gems switch, gem counts per character, reroll / supersede link on log entries) first; ST core only if it materialises projections; FU only if BL-46's rule needs a column |
| Dice log (`dice-roll-log`) | GM owns the reroll / supersede change; ST reads log facts after GM's core |
| Combat apply popup / damage cards | GM's max-dice step and FU's End dialog / concentration changes: one holder at a time, GM core first, then FU, then GM's popup UI (or the reverse, per seams) |
| Combat tracker rows | FU owns (compact companion line, encounter editor); ST's leaderboard reads, never edits rows |
| Play-shell frame | FU owns the parking rule / Reset layout / pushed windows; ST's Stats window registers through the window registry (append) after FU's frame slice |
| Canvas (`MapCanvas.tsx`, `TokensLayer.tsx`, `LabelsLayer.tsx`) | FU only (marker, refit, map jump); one holder |
| Snapshot ceilings (CON-44) | DM 1.5 MiB, players 512 KiB (#256); measure gem counts, rerolls and any stats snapshot; stats should be computed on demand, not snapshotted, unless measured small |
| Fixtures | Existing bundles keep behaving; session-sim-11 = session-sim-10 + sprint-7 units; state-changing e2e specs get their own alias bundles |

## Gates

1. **DM gate 1 (specs):** all three tracks reviewed; picks, scope, dependencies, ADRs, build order.
2. **Builds:** walkthrough PASS per slice; `check` + full `e2e` in the branch and on `main` after every merge; backlog items in idle slots (#286), not near the end.
3. **Sprint gate:** session-sim-11, "Playtest: sprint 7 features", recap.

## Expected DM questions (for the spec agents to frame, not to decide)

- Gems: where the on / off switch lives (campaign settings in the DM's Players / campaign panel vs the DM's Preferences — a per-campaign setting, not per-person) and what switching off does to gems already awarded (kept and hidden vs cleared); who sees a character's gems (OQ-GEM-01: counts for everyone?); spends always public in the log (OQ-GEM-02)?; gem look now (built-in icons vs your images; art sprint later, OQ-GEM-03); which rolls Inspiration can reroll (any of your own d20 rolls, how far back, after the DM applied it?); Combat gem timing (before Apply only, or also on a late damage roll; which die when there are several types); can the DM undo a spend / award; does the max-5 rule show a hint; Action gem's 2-for-1 shown or just logged.
- Stats: which stats are public vs per player vs DM-only; leaderboard where and when (a window, the Initiative footer, end-of-combat popup); overkill callout as a toast, a log line or both; what counts as "dealt" (applied amount vs raw roll; manual overrides; healing over max); session awards — what a session is and when awards show (End session button?); monsters on the leaderboard or players only; do past sessions get stats retroactively.
- Follow-ups: BL-46 — should a monster bound into a new encounter keep its HP (a downed goblin stays down) or reset; the compact companion line's contents; the End dialog's summon warning wording; parking vs shrinking order when both are possible.
