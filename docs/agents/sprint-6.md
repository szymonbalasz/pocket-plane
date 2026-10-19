# Sprint 6: companions and summons, window fixes, preferences, image search

DM decisions #285 (sprint-5 recap: nits 1–3, decisions 1 → A and 2 → A, image search + tags), #286 (sprint 6 scope); companions plan #252 + backlog BL-30. Process: [orchestrator prompt](orchestrator-prompt.md) (incl. **§3a backfill**), [continue-session §3](continue-session.md#3-herdr-how-to-run-agents-learned-the-hard-way) and its lessons. Sprint 5 for reference: [sprint-5](sprint-5.md) (same loop: specs in parallel → seams → two reviews → one DM gate → builds per hotspot rules → walkthroughs → session-sim → playtest section → recap).

## Tracks

DM notes in brackets ([#285](../decisions-log.md)). "sim-9" = the [session-sim-9 report](../../.verify/20261019-211926-session-sim-9/report.md) (local, gitignored; copy into each worktree) and the "Known gaps" of [Playtest: sprint 5 features](sprint-5.md#playtest-sprint-5-features).

| Track | What | Specs | New / revised | Prefix |
|---|---|---|---|---|
| **CP** companions + summons | **BL-30 (#252):** a creature with an **owner player** — pet (Drakewarden drake, pet owlbear: its own copy of a definition, HP kept between sessions, listed in the Party window) or summon (any compendium entry placed for a player, HP for that fight, Dismiss). **Turn mode** per creature: **right after the owner** (default, Tasha-style summons), **in the owner's turn** (drake, Beast Master: no own Initiative row), **own initiative** (Conjure Elemental, NPC allies). The owner gets a **companion card** built from the stat block (HP, AC, speed, attacks with Roll, conditions), the "your turn" alert, and attacks through the DM popup like any player's. Not a second character sheet. Builds on the sprint-5 ally side (`sideOf`, `publicSide`). Needs a superseding ADR for player visibility of an owned creature's stats (ADR-0024 / ADR-0036) | [entities](../specs/entities.md) (owner on a creature, pet copies), [combat-tracker](../specs/combat-tracker.md) (turn modes, summon / dismiss, owner's alerts and attacks), [character-sheet-full](../specs/character-sheet-full.md) (companion card), [party-board](../specs/party-board.md) (pets listed), [scenes-map](../specs/scenes-map.md) (owned tokens) | Revise (new spec sections) | ENT, CBT, CHARX, PARTY, MAP |
| **WF** window + layout fixes | **BL-38 → A (#285):** a reopened window whose stored spot is now covered is re-placed, otherwise it keeps your spot; BL-39 the PC rule uses token **footprints** (no window edge on a PC centre, no first placement mid-map over tokens while an edge slot is free); BL-40 the DM's "N pending actions" toast covers the Fog bar's second row and the map's top-left; BL-41 Fit squeezes the map (28 px with the right half empty at 1440×900; `pcs` top row under the top bar at 1280×720); BL-42 the players' east third under the Character sheet at 1280×800; BL-43 Initiative still cuts a hidden Ally's name and shows trigger text instead of an icon, the last row bleeds under "↓ N more"; BL-44 the dice tray hides its Roll button once dice are staged; BL-47 template "by ‹name›" on hover, not only while selected | [play-shell](../specs/play-shell.md), [scenes-map](../specs/scenes-map.md) (Fit), [combat-extras](../specs/combat-extras.md) / [combat-tracker](../specs/combat-tracker.md) (rows), [dice-extras](../specs/dice-extras.md) (tray), [scene-tools](../specs/scene-tools.md) (label), [notifications](../specs/notifications.md) (pending toast) | Revise | SHELL, MAP, CBTX, DICEX, SCN, NOTE |
| **PF** preferences + colours + loot nit | **A Preferences window** opened from the top-right player / DM area (expand that into Preferences) [2]: **player colour** with a **better picker** than 8 fixed options [1] (free colour + presets; keep contrast and colour-blind safety: casing, minimum distance between players), **sound settings move there** [2], and every future preference lives there (say which existing settings also move: dice look, reduced motion, others — DM question). **Loot nit** [3]: a negative amount stays the way to subtract, but with a negative value the button reads **Subtract**, the label updates, a hint says to enter a negative amount to subtract, and the button is disabled for empty or zero | [campaign-management](../specs/campaign-management.md) (colour, ADR-0055 amend), [play-shell](../specs/play-shell.md) (Preferences window), [notifications](../specs/notifications.md) (sound settings, ADR-0030), [dice-extras](../specs/dice-extras.md) (if dice settings move), [party-loot](../specs/party-loot.md) (Subtract) | Revise | CAMP, SHELL, NOTE, DICEX, LOOT |
| **IM** image search + tags | **A search field in every image picker** (token art / portrait, scene maps, handouts, props, compendium image slots, the attach control's "From library") with the **compendium's matcher**: whitespace-separated terms, partial, case-insensitive, all terms must match ("Gob el" finds Elite Goblin) — one shared matcher, not a copy. **Image categories** as simple tags: suggested Tokens, Maps, Handouts, Props, Portraits, Items, Other (spec agent proposes the list; the DM picks); multiple tags per image, a tag filter in the picker and the Assets library, auto-tag from the upload context (a token-art upload → Tokens), tags editable by the DM | [assets-pipeline](../specs/assets-pipeline.md) (tags, search, picker), [compendium](../specs/compendium.md) (shared matcher), [entities](../specs/entities.md) / [scenes-map](../specs/scenes-map.md) / [scene-tools](../specs/scene-tools.md) / [party-board](../specs/party-board.md) (their pickers) | Revise | ASSET, CMP, ENT, MAP, SCN, PARTY |

**Backlog for idle slots (DM #286: "pull more stories from the backlog when there are idle agents"):** BL-45 (silent no-ops: Sneak Attack offer default, physical form Roll), BL-46 (downed goblin back at full HP on rebind), BL-48 (small copy / UI list), BL-33 (random-ID leak-scan flake), BL-37 (keyboard Space / Tooltip focus), BL-13, BL-14; whatever else fits §3a. BL-36 (swatch Tooltip) likely goes with PF's new picker.

**Not this sprint:** 5etools class import; **the UI / art sprint** (BL-29: concept art first, its own slower sprint near the end). No restyling beyond the fixes above.

## Orchestrator: how to run this sprint

**Phase A: specs (one DM gate)**
1. Start **all four** spec agents at once: **CP**, **WF**, **PF**, **IM**. Copy inputs into each worktree (this file, the session-sim-9 evidence `.verify/20261019-211926-session-sim-9/`, the sprint-5 playtest section). Pre-assign new FR / OQ ID ranges per track in each brief for every shared spec (sprint-5 lesson: no collisions).
2. Each spec agent: options + bold pick per open question, a **measured** CON-44 figure for anything new in the snapshot or per-event traffic (heavy harness probe, not estimates; DM ceiling 1.5 MiB, players 512 KiB, #256), named tests, a §13 walkthrough, a build split with the shared files each slice touches, and the **dependency** it needs, if any, with alternatives (a colour-picker library vs hand-rolled / native input is PF's question).
3. Settle seams yourself (one `seams.md`, copied into each worktree; authors push back once). Expected seams: **CP ↔ WF** (the companion card window and owned rows vs placement / default sizes / Initiative rows), **CP ↔ PF** (none expected), **PF ↔ WF** (the Preferences window vs window placement, the top-right area in the play-shell frame), **IM ↔ CP** (summon from the compendium uses the picker / search?), **IM ↔ PF** (none), **IM ↔ WF** (picker windows' sizes). One shared matcher module (compendium's word search) — IM owns it.
4. Reviews: **two** review agents in parallel (review-a: CP + IM; review-b: WF + PF), then `rulings.md`, authors apply.
5. **DM gate 1**: every pick that needs the DM, scope cuts per track, **new dependencies** (a colour-picker library only if hand-rolled won't do), ADR acceptance (companions' player visibility; colour storage if ADR-0055 changes), build order. Integrate (number ADRs, index, glossary, registries in AGENTS §9.9, log) and merge the spec branches.

**Phase B: builds**
6. Cores first, one schema lane per conflict set (sprint-5: two lanes with a fixed merge order worked), then feature slices in parallel wherever the hotspot table allows. Stack a dependent slice on an unmerged branch with `--base` when it only needs that branch.
7. Every slice: builder → "ready for walkthrough" → test agent → fixes → `check` + full `e2e` in the branch after merging main → merge → `check` + full `e2e` on `main`. **Wait for the builder's commit before you check its worktree.** Never rebuild a worktree's client while a test agent walks it. Backlog backfill when a slot is idle (DM #286), never ahead of an unblocked sprint slice; stop once the last sprint slices are in flight.
8. Sprint gate: session-sim-10 on final `main` (bundle = session-sim-9 + sprint-6 units; incl. a pet owlbear and a summoned fire elemental with each turn mode, the owner's companion card + attack via the DM popup, Dismiss, reopened windows not stacking, the Fog bar clear of the pending toast, Fit at 1280×720 / 1440×900, the players' sheet not covering the map, the Preferences window (colour, sound), a negative loot amount reading Subtract, image search "Gob el" in every picker and a tag filter), leak scan per player, a "Playtest: sprint 6 features" section here, then **pause and recap with the DM**.

## Progress (updated as slices merge)

| Date | What |
|---|---|
| — | Not started (kickoff prompt from the sprint-5 recap) |

## Check `main` any time (DM)

Same as sprint 5: bundle **`session-sim-10`** once the sprint adds it (until then `session-sim-9`).

```powershell
git pull; bun install
bun run build
bun run fixtures:reset-load session-sim-9 --profile verify
bun run start --profile verify
```

## Boundaries and hotspots (sequence these)

| Overlap | Rule |
|---|---|
| Schema (`src/server/db/`) | Lanes with a fixed merge order: CP core (creature owner + turn mode + pet copies) and IM core (asset tags) can run in parallel with a merge order; PF core (colour storage, if it changes) after IM |
| Play-shell frame | WF owns placement / keep-outs / the reopen rule; PF's Preferences window registers through the window registry and the top-right area after WF's frame changes (sequence) |
| Combat tracker + Initiative rows | CP owns turn modes / owned rows; WF's row fixes (BL-43) first, then CP rebases |
| Canvas (`MapCanvas.tsx`, `TokensLayer.tsx`, `LabelsLayer.tsx`, tools) | One holder at a time: WF (Fit, BL-47 label) → CP (owned tokens) |
| Asset picker / ImageAttach / compendium matcher | IM owns; CP's summon-from-compendium uses it after IM's picker slice |
| Snapshot ceilings (CON-44) | DM 1.5 MiB, players 512 KiB (#256); measure every new record (companion cards, tags) |
| Fixtures | Existing bundles keep behaving; session-sim-10 = session-sim-9 + sprint-6 units |

## Gates

1. **DM gate 1 (specs):** all four tracks reviewed; picks, scope, dependencies, ADRs, build order.
2. **Builds:** walkthrough PASS per slice; `check` + full `e2e` in the branch and on `main` after every merge; backlog items in idle slots (#286), not near the end.
3. **Sprint gate:** session-sim-10, "Playtest: sprint 6 features", recap.

## Expected DM questions (for the spec agents to frame, not to decide)

- Companions: who creates one (DM only, or a player for their own summon spell?); a pet's stats editable by its owner or DM only; what players other than the owner see (band, not HP?); in-owner's-turn creatures: how the owner acts for them in the DM popup; Dismiss on concentration loss (automatic or DM); a summon that turns hostile (Conjure Elemental on lost concentration: switch to enemy, owner removed?); how many companions per player.
- Windows: the "covered" test for the reopen rule (any overlap vs > N %); footprint vs centre for PCs; Fit's trade-off at small screens (24 px floor vs PCs first vs avoid the toast box only while it shows — OQ-SHELL-40 again).
- Preferences: which settings move there (sound, dice look, reduced motion, layout reset, …); colour picker (free hue + presets vs a larger fixed palette); uniqueness (exact vs minimum distance); per-device vs per-player settings.
- Images: the tag list; one or many tags per image; auto-tagging rules; tag management (rename, delete); whether players can see / filter tags.
