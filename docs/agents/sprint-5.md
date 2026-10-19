# Sprint 5: windows, dice polish, late damage, uploads, compendium images, player colours

DM decisions #250 (sprint-4 playtest notes, items 1–12), #251 (sprint 5 scope). Process: [orchestrator prompt](orchestrator-prompt.md) (incl. **§3a backfill**), [continue-session §3](continue-session.md#3-herdr-how-to-run-agents-learned-the-hard-way) and its lessons. Sprint 4 for reference: [sprint-4](sprint-4.md) (same loop: specs in parallel → seams → review → one DM gate → builds per hotspot rules → walkthroughs → session-sim → playtest section → recap).

## Tracks

DM notes in brackets ([#250](../decisions-log.md)). "sim-8" = the [session-sim-8 report](../../.verify/20261018-030613-session-sim-8/report.md) glitch list (local, gitignored; copy into each worktree) and the "Known gaps" of [Playtest: sprint 4 features](sprint-4.md#playtest-sprint-4-features).

| Track | What | Specs | New / revised | Prefix |
|---|---|---|---|---|
| **W** windows + layout | sim-8 FAIL: launcher-opened windows (Compendium, Party, Encounters) auto-place on top of each other and over the Game log; tool bars under default windows (the DM's fog bar second row under Scenes, the players' AoE panel under Initiative); players' map under the Character sheet at 1280×800; the DM's top-centre roll popup and card toast cover the top of the map; Fit with Game log + Initiative (+ Scenes) hides the top rows or a monster; **Game log default width 2.5× today's** [7]; Initiative chips collapse ("Rage 10r +1" hides Divine Fury, BL-26); two "Invisible" items in the DM token menu; the Effect… dialog defaults its source to a hidden monster | [play-shell](../specs/play-shell.md), [scenes-map](../specs/scenes-map.md) (Fit), [dice-roll-log](../specs/dice-roll-log.md) (log window size), [combat-extras](../specs/combat-extras.md) (chips, Effect…), [fog-of-war](../specs/fog-of-war.md) (fog bar layout) | Revise | SHELL, MAP, CBTX, FOG |
| **D** dice polish | Roll popup: the dice **in a line at full size** instead of the shrunk scene still [2] (BL-22); tray compose shows the **3D die that will be rolled** instead of the "[1d6]" text badge [3]; the tray / log total waits for the dice to land; tray keeps an old label (BL-18); the physical form names each damage part's type (BL-20); "Alt: adjust in tray" hint on every roll button (BL-15); serve the 3D chunk compressed (BL-21) | [dice-extras](../specs/dice-extras.md), [dice-roll-log](../specs/dice-roll-log.md) | Revise | DICEX, DICE |
| **R** combat | **A damage roll after the DM applied the attack fills the open apply-to-targets popup** (never overriding a value already there, e.g. a player rolling twice) [8]; the DM's applied line shows Rage twice (BL-27); trigger parts keep their damage type on log lines (BL-23); punctuation after "DM ruled hit" (BL-24); combat trails differ between clients after a reload; **ally side** ([#252](../decisions-log.md)): the DM sets any combatant as an ally (or back), also one added as an enemy (charmed), and a planned entry can start friendly (companions / summons next sprint, BL-30) | [combat-tracker](../specs/combat-tracker.md), [effect-modifiers](../specs/effect-modifiers.md), [scenes-map](../specs/scenes-map.md) (trail) | Revise | CBT, MOD, MAP |
| **P** party + handouts + uploads | Party Loot moves under a new **Loot tab** in the Party window, right of Inventory; the Coin "open party loot" button goes [4]; sharing a handout can **force its image open** for players (everyone or chosen players) [5]; **direct upload** for handouts, not only from assets [11]; **paste an image from the clipboard** into text areas or as an attachment [12]; **add a compendium item to the party inventory** [9] | [party-board](../specs/party-board.md), [party-loot](../specs/party-loot.md), [assets-pipeline](../specs/assets-pipeline.md) (upload + paste), [compendium](../specs/compendium.md) (Add to party) | Revise | PARTY, LOOT, ASSET, CMP |
| **C** compendium images | Compendium entries support **images**: a custom item has one or more image slots, filled from uploaded assets or a direct upload (and clipboard paste [12]) [10]; shown in the entry view (both clients, per entry visibility) | [compendium](../specs/compendium.md), [assets-pipeline](../specs/assets-pipeline.md) | Revise | CMP, ASSET |
| **K** player colours | **BL-17 (A-tier):** players and the DM pick a colour; it carries through to their laser pointer, drawings, pings, templates, drag path, and appears in log lines and notifications | [campaign-management](../specs/campaign-management.md) (player record), [scenes-map](../specs/scenes-map.md) (pointers, path), [scene-tools](../specs/scene-tools.md) (templates), [dice-roll-log](../specs/dice-roll-log.md), [notifications](../specs/notifications.md) | Revise (small new spec section) | CAMP, MAP, SCN, DICE, NOTE |

**Not this sprint:** 5etools class import (compendium-expansion; DM #251: not yet). **The UI / art sprint** [6] (DM #250): a dedicated, slower sprint near the end — starts from concept art and reference images, assets via image genAI or hand-made SVG, iterating on small sections; see the backlog row BL-29. Don't pull UI restyling into sprint 5 beyond the layout fixes above.

## Orchestrator: how to run this sprint

**Phase A: specs (one DM gate)**
1. Start four spec agents at once: **W**, **D**, **R**, **P** (P owns the shared upload / paste control, see seams). Start **C** and then **K** as slots free. Copy inputs into each worktree (this file, the session-sim-8 evidence `.verify/20261018-030613-session-sim-8/`, the sprint-4 playtest section).
2. Each spec agent: options + bold pick per open question, a **measured** CON-44 figure for anything new in the snapshot or per-event traffic (heavy harness probe, not estimates), named tests, a §13 walkthrough, a build split with the shared files each slice touches, and the **dependency** it needs, if any, with alternatives.
3. Settle seams yourself (one `seams.md`, copied into each worktree; authors push back once). Expected seams: **P ↔ C** (one shared image attach control: asset picker + direct upload + clipboard paste, built once in assets-pipeline / common UI; compendium entry images and handout images both use it), **P ↔ C** (Add to party inventory from the compendium: compendium's action, party-board's command), **W ↔ D** (the roll popup's line layout vs the toast keep-out box and the DM's top-centre region covering the map), **W ↔ P** (Party window tabs vs window placement and default sizes), **W ↔ K** (none expected), **R ↔ D** (a late damage roll entering the apply popup: the roll entry and the popup's per-part fields), **K ↔ M-built files** (colours on drag path, templates, pointers: scenes-map / scene-tools client files).
4. Reviews: **two** review agents in parallel (review-a: W + D + K; review-b: R + P + C), then `rulings.md`, authors apply.
5. **DM gate 1**: every pick that needs the DM, scope cuts per track, **new dependencies** (none expected; clipboard paste is a browser API), ADR acceptance if any (e.g. asset upload from text areas, player colour as a record field), build order. Integrate (number ADRs, index, glossary, registries in AGENTS §9.9, log) and merge the spec branches.

**Phase B: builds**
6. Cores first, **one schema branch at a time** (see Hotspots), then feature slices in parallel wherever the hotspot table allows. Stack a dependent slice on an unmerged branch with `herdr worktree create --base <branch>` when it only needs that branch (sprint-4 lesson). If only one agent is working and no sprint task can start, §3a lets you fill a slot with a small backlog item (BL-12, BL-16, BL-28); stop doing that once the last build slices are in flight.
7. Every slice: builder → "ready for walkthrough" → test agent → fixes → `check` + full `e2e` in the branch after merging main → merge → `check` + full `e2e` on `main`. **Wait for the builder's commit before you check its worktree.** Never rebuild a worktree's client while a test agent walks it.
8. Sprint gate: session-sim-9 on final `main` (bundle = session-sim-8 + sprint-5 units; incl. launcher windows opening without stacking at 1280×720 / 1440×900 with the Game log + Initiative open, the fog bar and AoE panel reachable, a wide Game log, popup dice in a line at full size, 3D dice in the tray before rolling, a late damage roll filling the apply popup without overriding, deleting a kept template from its right-click menu, the Loot tab, a handout forced open for one player, an image uploaded and pasted into a handout and a homebrew item, a compendium item added to party inventory, player colours on pointer / template / path / log), leak scan per player, a "Playtest: sprint 5 features" section here, then **pause and recap with the DM**.

## Progress (updated as slices merge)

| Date | What |
|---|---|
| 2026-10-18 | Phase A: six specs, seams ([`.verify/sprint5/seams.md`](../../.verify/sprint5/seams.md)), two reviews + rulings, gate ([`gate.md`](../../.verify/sprint5/gate.md)). Ally side added to R ([#252](../decisions-log.md)). Backfill merged: BL-28 bench gates, BL-16 stable `useRecords`, BL-12 door eraser, BL-31 nat-1 e2e (#253–#255) |
| 2026-10-19 | **Gate 1 passed** ([#256](../decisions-log.md)): every pick, DM ceiling 1.5 MiB, DM popups stay top-centre, map tools push covering windows right. Phase B starts |
| 2026-10-19 | Merged: party core (handout force-open record, attachment images) [#257](../decisions-log.md). `session-sim-9` gains a handout with an attachment and one presented to Player 1 (UI comes with the popup slice) |
| 2026-10-19 | Merged: combat core (hit rulings, stored trails, ally sides, Apply-hit command) [#258](../decisions-log.md). Unblocks late damage, ally-switch UI, trails, colours core |
| 2026-10-19 | Merged: **kept-template right-click menu** (Delete, Edit…, DM Hide / Reveal) [#259](../decisions-log.md) — try it in `session-sim-9` on Goblin Ambush's kept templates |
| 2026-10-19 | Merged: **image picker** in the handout editor: Upload, drag a file in, or paste an image (Ctrl+V) [#260](../decisions-log.md) |
| 2026-10-19 | Merged: compendium image storage (server) [#261](../decisions-log.md); **handout force-open**: Share… → tick "Also open it on the screens of players who newly get it", or the viewer's "Open on screens…" / "Close on all screens" [#263](../decisions-log.md). In `session-sim-9`, Player 1 gets a presented handout popup on load |
| 2026-10-19 | Merged: **late damage** — in your attack popup, **Apply hit** tells the table "— DM: hit." and waits; the player's damage roll then fills the empty fields (your typed numbers stay) [#264](../decisions-log.md) |
| 2026-10-19 | Merged: **window layout** — launcher windows no longer stack or land on PC tokens, the Game log is 2.5× wide from 1440×900 (1.5× on laptops), a full screen minimises the oldest launcher window [#265](../decisions-log.md). Try Reset layout, then open Compendium, Party, Encounters |
| 2026-10-19 | Merged: **dice totals wait for the dice** in tray, popup and log; a fresh tray roll never keeps an old label [#266](../decisions-log.md) |
| 2026-10-19 | Merged: **Add to party** (Compendium → an item → Add to party, with a quantity) and the player-colour core (colours stored; the picker and map colours come next) [#267](../decisions-log.md) |
| 2026-10-19 | Merged: **Loot tab** in the Party window (right of Inventory); the old Party loot window and the Coin button are gone [#268](../decisions-log.md) |
| 2026-10-19 | Merged: **compendium images** — a homebrew entry takes up to 4 images (upload, drag in, paste); gallery + lightbox for you and players who can see the entry [#269](../decisions-log.md) |
| 2026-10-19 | Merged: **Initiative chips** — Divine Fury no longer hides behind Rage (trigger chips shrink to icons, rows wrap instead of cutting names); one Invisible item in your token menu; Effect… never picks a hidden monster as the source [#271](../decisions-log.md) |
| 2026-10-19 | Merged: **combat log wording** — "— DM ruled hit.", Rage shown once, "+ 10 piercing (Sneak Attack)" [#272](../decisions-log.md) |

## Check `main` any time (DM)

Run from `C:\Repos\pocket-plane` on `main` (PowerShell). Bundle **`session-sim-9`** = everything through sprint 4 (`session-sim-8`) plus every sprint-5 unit merged so far; it grows as slices land (see Progress).

```powershell
git pull; bun install
bun run build
bun run fixtures:reset-load session-sim-9 --profile verify
bun run start --profile verify
```

Open the printed DM URL (paste the secret) and each player link in its own browser (Player 1 = Mira, Player 2 = Thorn). Town is live at load: show Goblin Ambush from the Scenes window. Stop with `Ctrl+C`; re-run the last three lines after pulling new merges (player links change on every load).

## Boundaries and hotspots (sequence these)

| Overlap | Rule |
|---|---|
| Schema (`src/server/db/`) | Cores one at a time. Suggested order: P core (handout force-open, loot tab has no schema; party-inventory add from compendium) → C core (entry images) → K core (player colour) → R / W / D only if they need columns |
| Shared upload / paste control | P builds it first (assets-pipeline + `src/client/common/`), C consumes it; one holder |
| Play-shell frame, toast region, window registries | W owns (placement, default sizes, Game log width, tool bar layout); D's popup line layout after W's toast-region change (same files); P's Party window tabs register through the window registry (append) |
| Canvas (`MapCanvas.tsx`, `TokensLayer.tsx`, `LabelsLayer.tsx`, tools) | [1]'s template right-click delete (M-built scene-tools client) and K's colours (pointers, path, templates): one holder at a time; [1] first |
| Combat apply popup / cards | R only ([8], BL-27, BL-23, BL-24) |
| Dice display (tray, popup, log client) | D owns; R's log-line wording changes (BL-23, BL-24) go after D's log edits |
| Notifications / handouts | P owns handouts (force open = a notification kind or a handout flag; decide in spec) |
| Snapshot ceilings (CON-44) | DM 1 MiB, players 512 KiB (#208). Worst DM measured 863 KB in sprint 4: images (C, P) must load on demand, never in the snapshot; measure; never raise a ceiling without the DM |
| Fixtures | Existing bundles keep behaving; session-sim-9 = session-sim-8 + sprint-5 units |

## Gates

1. **DM gate 1 (specs):** all six tracks reviewed; picks, scope, dependencies, ADRs, build order.
2. **Builds:** walkthrough PASS per slice; `check` + full `e2e` in the branch and on `main` after every merge; backlog items only during downtime and not near the end (§3a).
3. **Sprint gate:** session-sim-9, "Playtest: sprint 5 features", recap.

## Expected DM questions (for the spec agents to frame, not to decide)

- Windows: should windows the DM opens from the launcher ever overlap (fallback when the screen is full: cascade vs least overlap vs ask); the Game log at 2.5× width at 1280×720 (does it shrink to fit?); tool bars: wrap, scroll or collapse into a menu.
- AoE [1]: right-click menu on a kept template (Delete, re-aim, change size?); who may delete (owner, DM); also for fog shapes and walls (already have menus?).
- Dice [2] [3]: popup line with many dice (10d6, 20d6: wrap to two lines? cap?); 3D dice in the tray compose: live spinning previews vs static faces; performance on phones.
- Late damage [8]: which popup a late roll joins (the open one for that attacker? the latest card?), what "never override" means per field (dice, total, per part), what the DM sees when it can't join.
- Handouts [5]: force open = a popup over everything vs open the handout window; dismiss behaviour; per-player targeting UI; does it work for players who join later.
- Uploads [11] [12]: max size / formats; where pasted images live (asset library with a tag vs hidden attachments); paste into text = inline image or attachment chip.
- Compendium images [10]: how many slots; shown to players for shared entries; used as token art for monsters?
- Colours (BL-17): palette (fixed set vs free picker), uniqueness per campaign, DM colour, colour-blind safety, where it shows (pointer, ping, drawings, templates, path, log name, notification accent).
