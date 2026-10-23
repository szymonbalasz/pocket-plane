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

## Check `main` any time (DM)

Bundle **`session-sim-12`** until the sprint adds `session-sim-13`.

```powershell
git pull; bun install
bun run build
bun run fixtures:reset-load session-sim-12 --profile verify
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
