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
| 2026-10-19 | Phase A started: four spec agents at once — companions + summons, window / layout fixes, Preferences + colour picker + Subtract, image search + tags (ID ranges per track in [status](status.md)) |
| 2026-10-20 | Phase A: four specs, seams ([`.verify/sprint6/seams.md`](../../.verify/sprint6/seams.md)), two reviews + rulings, gate ([`gate.md`](../../.verify/sprint6/gate.md)). Backfill: BL-33 leak-scan flake fixed (#287); BL-45 silent no-ops in progress |
| 2026-10-20 | **Gate 1 passed** ([#288](../decisions-log.md)): every pick, except a pet's owner may also edit its stats on the companion card. ADR-0056 companion visibility, ADR-0057 free player colour. Specs merged. Backfill merged: **BL-45** — an unticked Sneak Attack you rolled now shows "Not applied" with an Include button instead of vanishing; the physical-dice form marks the empty total (#289). Phase B started: window reopen + footprints, shared search matcher, image tags core, companions core |
| 2026-10-20 | Merged: **one shared search matcher** for the compendium and (soon) every image picker [#290](../decisions-log.md); **image tags core** — images carry tags (Tokens, Portraits, Maps, Handouts, Props, Items + your own), auto-tagged on upload, existing images guessed once; bundle **`session-sim-10`** [#291](../decisions-log.md) |
| 2026-10-20 | Merged: **reopened windows no longer stack** — a window whose old spot is now covered is re-placed, otherwise it keeps your spot; windows keep clear of whole PC tokens, and a window is only parked when no free spot exists [#292](../decisions-log.md). Try Reset layout, open Compendium / Party / Encounters, close, resize to 1280×720, reopen |
| 2026-10-20 | Merged: **free player colours (server)** — any colour that passes the contrast / colour-blind distance rules, stored as hex, old palette colours migrated [#293](../decisions-log.md); **Initiative rows** — names, trigger chips and the AC / HP line never cut, nothing under "↓ N more" [#294](../decisions-log.md); **companions core** (server: owners, turn modes, pets, who sees what) [#295](../decisions-log.md) |
| 2026-10-20 | Merged: **image search in every picker** — type "Gob el" in token Image…, New scene, Props, Portrait, handout or compendium From library; tag chips, tag editor, Manage tags [#296](../decisions-log.md). Try it in bundle `image-search` |
| 2026-10-20 | Merged: **your pending-actions toast stays top-centre** and never covers the Fog / AoE / Structure bars [#297](../decisions-log.md); **dice tray Roll always visible** at the small default size, and a kept template shows "· by ‹name›" on **hover** [#298](../decisions-log.md) |
| 2026-10-20 | Merged: **Preferences** — click your name chip at the top right: Sound (moved from the speaker), Reset layout, and for you Log out; **loot Subtract** — a negative amount reads "Subtract" with a hint, empty / 0 disabled [#299](../decisions-log.md). The colour picker and dice settings join Preferences next |
| 2026-10-20 | Merged: **companion turns** — companions show in Initiative under their owner ("After Mira") or as a line in the owner's row; Companion ▸ menu (owner, turn mode, Turn hostile); pets join at Start; "Your turn — Owlbear (Mira)" alerts [#300](../decisions-log.md); **timing checks moved to the bench** so test runs stop going red on load (BL-51, #301) |
| 2026-10-20 | Merged: **Fit** — the map uses the space (42 px cells at 1440×900 instead of 28), keeps the top row below the top bar, and players' maps re-frame once when new tokens come into sight under a window; your roll popups stay clear of tool bars and toasts [#302](../decisions-log.md). Last slice started: companion marker on the map. Backlog picking stopped (sprint end) |
| 2026-10-20 | Merged: **colour picker** — Preferences → Your colour: any colour that passes the contrast / colour-blind rules, the 8 palette colours as suggestions, a clash shows why; Dice settings in Preferences too [#303](../decisions-log.md). **Preferences track done** |
| 2026-10-20 | Merged: **companion card** (HP, AC, speed, attacks with Roll, conditions; the owner edits a pet; you open it from Initiative) [#304](../decisions-log.md); **pets** (Party → Companions, New pet / Make pet, pet HP outside a fight) [#305](../decisions-log.md); placement test follow-up [#306](../decisions-log.md); **paw marker** on companion tokens in the owner's colour, owner double-click opens the card [#307](../decisions-log.md). **Window track done.** Left: summon / Dismiss |
| 2026-10-20 | Merged: **summons** — Mira's row → Summon for Mira… ("fire el" → Fire Elemental), Dismiss (you, or the owner from the card), the concentration card (Turn hostile / Dismiss summon(s)), End removes summon tokens [#308](../decisions-log.md). **All 20 slices merged**; final main check 4,126, e2e 170. session-sim-10 run |
| 2026-10-20 | **Sprint gate:** session-sim-10 **9 / 11 PASS** on final `main` (leak scan clean, hard kill byte-identical); FAILs: windows can still land on PCs, the drake's paw marker after End → Start. [Playtest: sprint 6 features](#playtest-sprint-6-features) written. Paused for the recap |

## Check `main` any time (DM)

Bundle **`session-sim-10`** (sim-9 + tagged images, Player 2's free colour, the Owlbear and drake pets, summons in the running fight).

```powershell
git pull; bun install
bun run build
bun run fixtures:reset-load session-sim-10 --profile verify
bun run start --profile verify
```

## Playtest: sprint 6 features

Run from `C:\Repos\pocket-plane` on `main` (PowerShell). ~10–15 minutes per part. **DM** (normal browser) + **Player 1** (incognito: Mira and Brakka) + **Player 2** (another browser: Thorn). Regression run: [session-sim-10 report](../../.verify/20261020-181950-session-sim-10/report.md) (local, gitignored): **9 / 11 PASS** on final `main` (check 4,126, e2e 170), leak scan clean (WS + REST, both players) with companions, pets, summons, image tags and Preferences in play; a hard kill mid-combat with two summons, a hurt pet and an open concentration card restarted byte-identical (digest equal). The two FAILs are the first known gaps below.

### Setup

```powershell
git pull; bun install
bun run build
bun run fixtures:reset-load session-sim-10 --profile verify
bun run start --profile verify
```

Open the printed DM URL (paste the secret) and each player link in its own browser. Town may be live at load: show Goblin Ambush from the Scenes window. Player 1 may get a presented handout popup at load — close it. The Ambush fight is running with companions already in it (Mira's pet Owlbear, Brakka's Drake Companion, three Fire Elementals). To create pets and summons yourself from scratch, load `companions-prep` instead. To switch bundles: `Ctrl+C`, `bun run fixtures:reset-load <bundle> --profile verify`, `bun run start --profile verify`; player links change on every load.

### Part 1: companions and summons (`session-sim-10`, or `companions-prep` from scratch)

| # | You do | Expect |
|---|---|---|
| 1 | Look at Initiative | The Owlbear and a Fire Elemental sit right under Mira ("After Mira"); Brakka's row holds the Drake Companion and Fire Elemental 2 as lines (they act in Brakka's turn); Fire Elemental 3 has its own initiative 9 ("Thorn") |
| 2 | Next through Mira | Player 1: "Your turn — Mira", then "— Owlbear (Mira)", "— Fire Elemental (Mira)"; at Brakka "Your turn — Brakka + Drake Companion, Fire Elemental 2"; Player 2 none of these |
| 3 | Player 1: Initiative → the Owlbear's card icon (or double-click the Owlbear token) | Companion card: HP, AC, speed, size / type, attacks with Attack / Damage / Attack + damage, conditions; no skills / saves / spells. Paw markers in Player 1's colour on companion tokens for everyone |
| 4 | Player 1: Claws **Attack + damage**; you: toast → popup → target a goblin → Apply | Works like a player's card; Player 1's log has the dice; Player 2 sees only "Owlbear attacks Goblin: N — DM: hit. M slashing damage" (no bonus, no dice) and a band, never HP |
| 5 | Player 1: card → **Edit** → AC 15 | Your row shows AC 15 at once (a pet's owner may edit its stats, #288); a summon's card has no Edit |
| 6 | Mira's row → **Summon for Mira…** → "fire el" → Fire Elemental ×1, After the owner (leave "Linked to concentration" unticked unless you mean it) | A new Fire Elemental token beside Mira, owned by Player 1, right after Mira in the order |
| 7 | Player 1 or you: a summon → **Dismiss** (not on its own turn) | Row and token gone for everyone; "… is dismissed" in the log |
| 8 | Player 2 ends Thorn's concentration (Active effects) | You get a card "Thorn lost concentration (Conjure Elemental): Fire Elemental 3" → **Turn hostile** (owner and Ally gone, it fights against the party) or **Dismiss summon(s)** |
| 9 | Party → **Companions** tab | You: every pet + New pet…; Player 1: their pets with HP + Card; Player 2: only pets in play, a band only |
| 10 | End the fight; Start "Escort to the Ford" | Summon tokens are gone; the Owlbear keeps its HP (45 / 59) and joins at Start; a mode change made in the last fight didn't stick |
| 11 | Creatures → a monster row → **Make pet…** → owner Mira | "Owlbear (Mira)"-style pet with the badge "Pet of Mira"; Player 2 learns nothing until you put it on the map |

### Part 2: windows and layout (`session-sim-10`)

| # | You do | Expect |
|---|---|---|
| 1 | 1440×900: launcher → Compendium, Party, Encounters; close them; resize to 1280×720 and back; reopen | A window whose old spot is now covered is re-placed, otherwise it reopens where you left it; windows never overlap each other (the oldest launcher window minimises to the launcher when the screen is full) |
| 2 | With a "N pending actions" toast showing: Scenes at the top-left, then the Fog tool, AoE, Structure | The toast stays top-centre and never covers a tool bar; every Fog bar control is clickable |
| 3 | Fit with Game log + Initiative at 1440×900 and 1280×720 | The map uses the space (≈ 42 / 34 px cells, was 28), every token visible, the top row below the top bar |
| 4 | Players at 1280×800: open a door / Reveal all so new tokens come into sight | Their map re-frames once so the new tokens aren't under the sheet; if they pan or zoom first, it doesn't move |
| 5 | Initiative at 320 px wide | Names wrap instead of "…", trigger chips become ⚡ icons, the AC / HP line moves down whole, nothing under "↓ N more" |
| 6 | Player 1: dice tray at 300×240, stage 12 d6 | The Roll button stays visible without scrolling |
| 7 | Hover a kept template (its area or its label) | "· by ‹name›" appears on hover and goes when you move away |

### Part 3: Preferences (`session-sim-10`, or `prefs-s6`)

| # | You do | Expect |
|---|---|---|
| 1 | Click your name chip (top right, "● DM ⚙"); Player 1 the same | Preferences: you get Your colour, Dice, Layout, Account (Log out lives here now); players get Your colour, Sound, Dice, Layout. The old speaker button is gone (the chip shows when sound is muted) |
| 2 | Player 1: Your colour → drag in the colour square, type a hex, try a taken / too dark / too grey colour | Allowed colours apply everywhere at once; blocked ones say why ("Taken by Player 2", "Too dark to read on the map", "Too close to DM's colour for colour-blind players"); the 8 palette colours are suggestions |
| 3 | You: Players panel → a player's colour | The same picker, for any player |
| 4 | Player 1: Sound → mute; Dice → Flat | The chip shows muted; the tray gear shows the same Dice setting |
| 5 | Party → Loot → type −5 in gp; then 0; then clear it | "Subtract" with the hint "Enter a negative amount to subtract."; 0 / empty disabled |

### Part 4: image search and tags (`session-sim-10`, or `image-search`)

| # | You do | Expect |
|---|---|---|
| 1 | Right-click a token → Image… → type `Gob el` | Exactly Elite Goblin and Goblin Elder; the same in Scenes → New scene (map), Props, a creature's Portrait…, a handout's From library and a homebrew item's From library |
| 2 | Click the tag chips (Tokens, Maps, Portraits, …, Untagged) | Each lists its images; chip + search combine |
| 3 | Upload an image from the token picker | It's tagged Tokens automatically |
| 4 | Select an image → add tag `Dungeon`; Manage tags → Rename Dungeon to `maps` | "Merge Dungeon into Maps? 1 image" → Maps grows by one; built-in tags can only be deleted |
| 5 | Players | No picker, no tags anywhere |

### Known gaps / later

- **Windows can still land on PCs (FAIL b):** windows never overlap each other now, but when no spot is clear of both windows and PCs, a window covers a PC (the rule you accepted: only park a window when nothing is clear of windows). At 1440×900 a reopened Encounters covered all three PCs; a player's Reset layout put Compendium over Mira. Worth a decision: park the oldest window instead of covering a PC, or shrink harder.
- **Player 1's sheet covers revealed tokens while the companion card is open** (FAIL b): the reveal re-frame didn't happen with the card open (also after a reload).
- **The Drake's paw marker disappears after End → Start** of the next fight (FAIL a); the Owlbear keeps its.
- The DM's map can jump: Start zoomed the map so Thorn sat under the Game log; Fit with Scenes + a toast open drops to 24 px; the pending toast can cover the Scenes window's first row while windows are pushed by the Fog bar.
- The encounter editor's rows show no creature names in its 320-px window; Creatures names cut ("Fire Elem…").
- Your Initiative fills fast with companions (an in-turn line takes ≈ 3 rows; part 2 of the companions walkthrough starts at "↓ 9 more", BL-56); the companion card opens at its minimum size with attacks below the fold.
- Concentration: the "Concentrating: Conjure…" chip is cut text in players' Initiative / sheet and does nothing on click; End doesn't warn that summon tokens will go; a hostile summon's token stays after End.
- A downed goblin is back at full HP in the next encounter (BL-46, still open); pushed windows stay pushed after the tool closes; server log spam when companions take a player's 4 vision slots (BL-55); the tool rail overlaps window content at 320 px (BL-53).
- Small copy: "Drake / Compa / nion" can still break mid-word at 320 px; "Make pet from Drake Companion" offered on a pet row; roll-bar line "Player 1 — 2d6+1"; C's Preferences opened mid-map.

### Teardown

`Ctrl+C` the server, then:

```powershell
bun run fixtures:reset --profile verify
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
