# Sprint 3: vision, dice, rules, party board, compendium

DM decisions #201 (fog v2 + dynamic vision), #202 (walls), #203 (sprint 3 scope), #204 / #205 (backlog only fills idle slots; sprint milestones first). Process: [orchestrator prompt](orchestrator-prompt.md) (incl. **§3a backfill**), [continue-session §3](continue-session.md#3-herdr-how-to-run-agents-learned-the-hard-way) and its lessons. Sprint 2 for reference: [sprint-2](sprint-2.md) (same loop: specs in parallel → seams → review → one DM gate → builds per hotspot rules → walkthroughs → session-sim → playtest section → recap).

## Tracks

| Track | What (DM's words, #201–#203) | Specs | New / revised | Prefix |
|---|---|---|---|---|
| **V** vision | Fog v2: freeform shapes with drawing tools (grid snap unless Ctrl); **dynamic vision** with a per-character vision / darkvision radius piercing fog; three fog kinds **Fog / Explored / Magical darkness**; per-map Explored toggle; sheet setting "sees through magical darkness" (fully dark screen inside darkness without it; darker transparent overlay with it); **walls freeform with Ctrl**; **red wall highlight while dragging over a wall** | [fog-of-war](../specs/fog-of-war.md) (revision block at the top), [scene-tools](../specs/scene-tools.md) (walls), [character-sheet-full](../specs/character-sheet-full.md) (vision fields) | Revise all three; complete [ADR-0042](../architecture/adr/0042-dynamic-vision.md) | FOG, SCN, CHARX |
| **D** dice | **3D dice**, **dice tray**, **clickable dice notation** in free text, **dice customisation** (per-player look) | stub [post-mvp/dice-extras](../specs/post-mvp/dice-extras.md) → `docs/specs/dice-extras.md` | New spec | DICEX |
| **R** rules | **Effect modifiers tiers 1–3** (tier 1 built; tiers 2–3 per [MOD §14.2](../specs/effect-modifiers.md)) + a **flexible conditional trigger system** on the event stream; reference case **Zealot barbarian Divine Fury** (+1d6 + half barbarian level radiant, first hit each turn while raging); many such class features expected | [effect-modifiers](../specs/effect-modifiers.md) (revision block) | Revise; complete [proposed-rule-triggers](../architecture/adr/0043-rule-triggers.md) | MOD |
| **P** party | **Party board + handouts** | stub [post-mvp/party-board](../specs/post-mvp/party-board.md) → `docs/specs/party-board.md` | New spec | PARTY |
| **C** compendium | **Compendium** (SRD import, browse / search, clone to campaign, homebrew; feeds trigger presets) | stub [post-mvp/compendium](../specs/post-mvp/compendium.md) → `docs/specs/compendium.md` | New spec | CMP |

## Orchestrator: how to run this sprint

**Phase A: specs (one DM gate)**
1. Start four spec agents at once: **V** (one agent across fog-of-war, scene-tools walls, character-sheet-full vision fields: one design for vision), **D**, **R**, **P**. Start **C** the moment any of them finishes. Copy inputs into each worktree (this file, the relevant session-sim-6 evidence `.verify/20261015-232530-session-sim-6/` for V, the proposed ADRs are on `main`).
2. Each spec agent: options + bold pick per open question, a **measured** CON-44 figure for new record types (heavy harness probe, not estimates; sprint-2 lesson), named tests, a §13 walkthrough, a build split with the shared files each slice touches, and the **dependency** it needs, if any, with alternatives.
3. Settle seams yourself (one `seams.md`, copied into each worktree; authors push back once). Expected seams: V ↔ scene-tools (walls block sight; freeform segments in the move guard), V ↔ combat (vision-hidden monsters; per-player visibility of combatants), V ↔ live-sync (per-player visibility filter, ADR-0039 → per-player), R ↔ dice (tier-2 boxes per bonus die vs the new tray), R ↔ combat (trigger parts on cards / apply / undo), R ↔ C (class-feature presets from compendium data), P ↔ party-loot / character-sheet inventory, D ↔ character-sheet / notes (clickable notation in sheet text).
4. Reviews: **two** review agents in parallel (review-a: V; review-b: D, R, P, C), then `rulings.md`, authors apply.
5. **DM gate 1**: every pick that needs the DM, scope cuts per track, **new dependencies** (3D dice / physics library; geometry / visibility-polygon / polygon-clipping library), ADR acceptance (dynamic vision, rule triggers, any new ones), and build order. Integrate (number ADRs, index, glossary, registries in AGENTS §9.9, log) and merge the spec branches.

**Phase B: builds**
6. Cores first, **one schema branch at a time** (see Hotspots), then feature slices in parallel wherever the hotspot table allows. If only one agent is working and no sprint task can start, §3a lets you fill a slot with a small backlog item; stop doing that once the last build slices are in flight.
7. Every slice: builder → "ready for walkthrough" → test agent → fixes → `check` + full `e2e` in the branch after merging main → merge → `check` + full `e2e` on `main`. **Wait for the builder's commit before you check its worktree** (sprint-2 lesson).
8. Sprint gate: session-sim-7 on final `main` (incl. a freeform fog shape, Explored memory, magical darkness with and without Devil's Sight, darkvision piercing fog, a freeform wall with the red drag highlight, the 3D tray rolling a clicked notation, a Zealot Divine Fury trigger once per turn, a handout, a compendium monster cloned into an encounter), leak scan per player, a "Playtest: sprint 3 features" section here, then **pause and recap with the DM**.

## Boundaries and hotspots (sequence these)

| Overlap | Rule |
|---|---|
| Schema (`src/server/db/`) | Cores one at a time. Suggested order: V core (fog shapes + migration from the cell mask, vision fields) → R core (trigger records, counters) → P core → C core (compendium tables) → D (customisation prefs, if stored server-side) |
| Visibility filter / `src/server/ws/` | V owns the per-player visibility change (fog subjects, combat copies). Nobody else edits ws / snapshot code while V core is open |
| Canvas (`MapCanvas.tsx`, layers, tools) | V owns (fog drawing tools, vision render, darkness overlay, wall drag highlight). D's 3D dice "over the battlemap" mode (if picked) goes after V's canvas slices |
| Roll control (`src/client/common/features/dice-roll-log/`) | D first (tray wraps / replaces the roll control), then R's tier-2 "box per bonus die" on top of the tray |
| Combat attack / damage / apply (`combat-tracker` server + popup) | R's trigger parts on cards / apply / undo; V's vision-hidden combatant copies touch lifecycle / token hooks: different files, but schedule R's combat slice after V's combat slice if both touch `hooks.ts` |
| Character sheet folder | V (vision fields) → R (tier-3 uses, trigger presets on features) → D (clickable notation in sheet text) → P (inventory / handouts links), one at a time |
| Snapshot ceilings (CON-44) | Heavy DM ~676 KB of 786 KB now. Vision / explored memory per player and compendium data are the risks: measure per slice; never raise a ceiling without the DM; compendium data should load on demand, not in the snapshot |
| Fixtures | New scenes are fully fogged since #196 (FR-FOG-25 ripple): fog v2 must keep existing bundles behaving as today |

## Gates

1. **DM gate 1 (specs):** all five tracks reviewed; picks, scope, dependencies, ADRs, build order.
2. **Builds:** walkthrough PASS per slice; `check` + full `e2e` in the branch and on `main` after every merge; backlog items only during downtime and not near the end (§3a).
3. **Sprint gate:** session-sim-7, "Playtest: sprint 3 features", recap.

## Expected DM questions (for the spec agents to frame, not to decide)

- Vision: shared party vision vs each player sees only their own characters' vision; do walls block sight; Explored memory per player or per party; how "darkvision" differs from normal vision in dim / dark areas (no lighting model: probably radius only).
- Dice: 3D library choice (size, licence, offline); tray placement (window vs over the map); customisation scope (colours / materials / per-roll-kind); whether physical-dice entry stays.
- Rules: where triggers run; formula language; which class-feature presets ship.
- Party board: handout reveal model vs entity visibility; inventory transfer; gold ledger vs party-loot.
- Compendium: source (bundled SRD JSON vs Open5e download; licence per ADR-0018), what's in (monsters, spells, items, class features), homebrew editor scope.

## Playtest: sprint 3 features

Run from the repo root on `main` (PowerShell). ~15 minutes per part. **DM** (normal browser) + **Player 1** (incognito: Mira, and Brakka in part 3) + **Player 2** (another browser: Thorn). Regression run: [session-sim-7 report](../../.verify/20261017-005557-session-sim-7/report.md) (local, gitignored): 14 / 15 PASS, leak scan clean (WS + REST, both players) with vision, darkness, Invisible, triggers, handouts and compendium in play; hard kill mid-combat kept a pending Divine Fury card byte-identical. The one FAIL is the first known gap below.

### Setup

```powershell
bun install
bun run build
bun run fixtures:reset-load vision --profile verify
bun run start --profile verify
```

Open the printed DM URL (paste the secret) and each player link in its own browser. To switch bundles: `Ctrl+C`, `bun run fixtures:reset-load <bundle> --profile verify`, `bun run start --profile verify`; player links change on every load. 3D dice: judge the frame rate on the table laptop.

### Part 1: vision, darkness, walls, Invisible (`vision`)

Goblin Ambush: Mira has 30 ft vision, Thorn darkvision 60 ft and sees through magical darkness; a darkness area sits in the south room.

| # | You do | Expect |
|---|---|---|
| 1 | View Goblin Ambush, **Show to players** | You: translucent fog, a lighter Explored corridor, hatched darkness. Player 1 sees only Mira's sight area (cut by walls); Player 2 sees Thorn's darkvision ring dimmed and grey |
| 2 | **Fog** tool → Fog + Polygon, hold **Ctrl** while clicking corners | Corners go off-grid ("Free", "≈ 11 ft"); players see the new shape at once |
| 3 | **Structure** → Wall with **Ctrl** held: a three-point wall | An off-grid wall; Player 1 dragging Mira across it sees it turn red and the drop is refused; your own drag shows "through wall" and is allowed |
| 4 | Open a door; Player 1 walks Mira to it and back | A goblin beyond appears while in sight and disappears after; the cells she saw stay dim (Explored) for her only |
| 5 | Drag Thorn into the darkness | Player 2: darker see-through tint, sees inside. Then Thorn's sheet → **Sees through magical darkness** off: Player 2's screen goes dark (grid + Thorn only, "Magical darkness — you can't see" under the top bar); on again restores it |
| 6 | Goblin 2's token menu → **Invisible**; Thorn's sheet → **Sees invisible** on (DM only) | You see Goblin 2 faded with an "Invisible" badge; Player 2 sees it; Player 1 never does |
| 7 | Fog bar → **View as** Player 1, then Player 2 | Their exact view overlaid on yours |
| 8 | Clear Mira's vision on her sheet | The fog bar warns "No vision set for: Mira"; restore it |
| 9 | Stop the server and start it again | Shapes, darkness, memory, Invisible and every player's view unchanged |

### Part 2: dice tray, 3D dice, looks, notation (`dice-extras`)

| # | You do | Expect |
|---|---|---|
| 1 | Player 1 opens the dice tray, rolls 1d20 | 3D dice for everyone in Player 1's stored look (crimson metal); with reduced motion: flat chips in the same colours |
| 2 | Player 2: tray settings → **Dice look** → Emerald, glass, Save; roll | Everyone sees emerald glass; kept after a reload |
| 3 | Player 1: Mira's sheet → Features → "Notation test", click "1d12 + 5" | The tray opens composed (d12 + 5, label "Notation test"); Shift / Ctrl+click on "1d20+3" preselects advantage / disadvantage |
| 4 | You: a hidden roll | Your throw only; players see nothing |
| 5 | A roll with bonus dice in the tray's labelled groups; advantage preview | Each group shows on the roll line; the preview shows both d20s |

### Part 3: rule triggers in combat (`rule-triggers`)

Brakka (Player 1) is a Zealot-style barbarian: Rage (3 uses) and **Divine Fury** as trigger data (first hit each turn while raging: 1d6 + half barbarian level radiant). Thorn has Sneak Attack. The Wolf has Regeneration, the Elite Martial Advantage (both DM-only).

| # | You do | Expect |
|---|---|---|
| 1 | Player 1: Brakka's sheet → Active effects | Triggers "Divine Fury … = 1d6+2"; Rage 3 / 3 |
| 2 | Start the fight, Next to Brakka; Player 1: Rage on, Greataxe **Attack + damage** | Rage 2 / 3; card "… (+ 6 radiant Divine Fury on a hit)"; the roll line says the same |
| 3 | Popup on a goblin: chip "+ N radiant Divine Fury" ticked → Apply | Damage includes the radiant part; Undo puts it back |
| 4 | Player 1 attacks again the same turn | No Divine Fury offer (once per turn); next round it's back |
| 5 | Elite attacks a raging Brakka; tick Martial Advantage, set 9 | Halved with the weapon damage (+ 4); players read "+ 4 (DM)", never the name |
| 6 | Player 2: Thorn attacks with Shift (advantage) | Sneak Attack offered and applied once per turn |
| 7 | Next to the Wolf | Only you get "Wolf: Regeneration — regain 10 HP …" |

### Part 4: party board (`party-board`)

| # | You do | Expect |
|---|---|---|
| 1 | Open **Party** | Handouts (newest first, with who they're shared with) and the party inventory |
| 2 | New handout with an image → Share with Player 1, then everyone | Toast + "New" for each player as they gain it; Player 2 never sees it before |
| 3 | Unshare while both players have it open | "No longer shared" for both |
| 4 | Inventory: Add "Healer's kit"; Player 1 **Take** a potion to Mira; **Give…** bolts from Mira to the party | Rows update for everyone; Mira's sheet Inventory changes; log rows "Party → Mira: …" |
| 5 | Party loot → **Split…** Mira + Thorn | Preview "Each gets 2 pp, 15 gp; 1 pp stays in the pot"; wallets updated |

### Part 5: compendium (`compendium`)

| # | You do | Expect |
|---|---|---|
| 1 | Launcher → **Compendium** → **Update** → confirm | "Players will pause for ~2 s"; ~1,150 entries |
| 2 | Search "goblin", open Goblin; click "1d6 + 2" | Stat block with attribution; the click stages a "Scimitar" damage roll |
| 3 | Goblin → **Derive…** "Goblin Sneak", HP 12, copy text on | A custom monster with Nimble Escape on its NPC sheet; add it to "Ambush at the Ford" |
| 4 | Clone Potion of Healing → "Potion of Greater Healing (house)", Shared on | Player 1 finds it; a DM-only homebrew stays invisible to players |
| 5 | Player 2: Features → Rogue "Sneak Attack" → **Add to sheet** (Thorn) | Thorn's Features row + Sneak Attack trigger |
| 6 | Map: drag Hobgoblin from results; token menu → **Stat block** | Token placed; the window opens on its entry |

### Part 6: a whole session (`session-sim-7`)

Everything above in one world (session-sim + vision + triggers + dice looks + party board + compendium): run the [MVP playtest script](playtest-mvp.md) on it, weaving in parts 1–5.

### Known gaps / later

- ~~Add to sheet duplicates a trigger~~ fixed after the recap (#241): a trigger the character already has is skipped with "Trigger already on the sheet — delete it first to use the compendium's".
- Window placement on the battlemap: DM Initiative covers monsters on Goblin Ambush; Initiative opens over the Compendium at Start; the player sheet covers the east of the map at 1280×800; an empty Handout window comes back after a player reload.
- After an SRD import the thin fixture Goblin ranks above the SRD Goblin in search and lookups; the "All" tab opens on many "Ability Score Improvement" rows.
- Fit still cuts the top of Goblin Ambush with the Game log open (BL-01, tried and reverted this sprint); at 1280×720 the DM dock is clipped at both ends.
- session-sim-7's Brakka has no senses, so "No vision set for: Brakka" shows from load (fixture gap).
- Labels: "Invisi…" badge over a name, adjacent Goblin Sneak labels overlap, the 3D throw caption covers a token label; compendium / derived monsters have no token art (initials).
- Narrow Initiative rows still show "+1" in some layouts; the tray offers "Divine Fury +1d6" after it was used this turn (the roll correctly adds nothing); the first 3D throw of a session renders flat while the 3D chunk loads.
- Still from sprint 2: players read "9 — hit!" after a DM ruling (BL-10, needs your call on the copy); "Clear templates" has no confirm and removes players' kept templates (BL-05); Konva layer warning (BL-07).
- Later by design: a Divine Fury class import from 5etools (compendium-expansion); homebrew form can't edit spell classes / material / item cost and weight; Alt hint missing on non-sheet roll buttons (BL-15); `useRecords` array stability (BL-16).

### Teardown

`Ctrl+C` the server, then:

```powershell
bun run fixtures:reset --profile verify
```
