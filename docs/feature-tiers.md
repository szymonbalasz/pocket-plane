# Feature tiers

DM's ranking of features seen in Roll20, Foundry, Owlbear Rodeo etc. Source of truth for "is this in?" Feeds [ADR-0014](architecture/adr/0014-mvp-scope.md), the [roadmap](roadmap.md) and specs.

## Legend

| Tier | Meaning | Where it lands |
|---|---|---|
| **S** | Need it ASAP | MVP |
| **A** | Good to have soon | First post-MVP iterations |
| **B** | Lightweight, simple version — **not MVP**; discuss when needed. If it's near-free during build, fine to include | Post-MVP, on demand |
| **C** | Some version eventually | Post-MVP backlog |
| **D** | Unlikely to add | Not planned |
| **F** | Don't need it | Never (e.g. other game systems) |

## 1. Map and tokens

| Feature | Tier | Spec | Notes |
|---|---|---|---|
| Snap tokens to grid | S | [scenes-map](specs/scenes-map.md) | |
| Token sizes (Large/Huge span squares) | S | [scenes-map](specs/scenes-map.md) | |
| Ping: flash a spot; DM pulls everyone's view there | S | [scenes-map](specs/scenes-map.md) | |
| **Laser pointer** on right-click drag (unless on a token), Owlbear-style | S | [scenes-map](specs/scenes-map.md) | Added by DM |
| Lock map/background | S | [scenes-map](specs/scenes-map.md) | |
| Token labels (name, "Goblin 2") | S | [scenes-map](specs/scenes-map.md) | |
| DM controls any token; reassigns ownership | S | [scenes-map](specs/scenes-map.md) | |
| HP bar/ring on token | A | [combat-extras](specs/combat-extras.md) | |
| Condition icons on token | A | [combat-extras](specs/combat-extras.md) | Needs conditions ([combat-extras](specs/combat-extras.md)) |
| Layers (map / objects / tokens / DM-only) | A | [scene-tools](specs/scene-tools.md) | DM-only layer ≈ hidden tokens |
| Doors and walls (block movement) | A | [scene-tools](specs/scene-tools.md) | Movement only; no vision ([ADR-0007](architecture/adr/0007-product-scope.md)) |
| Highlight current-turn token | B | [combat-tracker](specs/combat-tracker.md) | Initiative strip / portraits show whose turn in MVP; token highlight only if trivial |
| Movement measured along drag path, waypoints | B (indicator vs speed: S, §8) | [scenes-map](specs/scenes-map.md) | |

## 2. Combat

| Feature | Tier | Spec | Notes |
|---|---|---|---|
| **Encounter builder with CR difficulty** | S | [combat-tracker](specs/combat-tracker.md) | Needed to build the first MVP encounter |
| Roll initiative for all monsters in one click | S | [combat-tracker](specs/combat-tracker.md) | |
| Players see monster health as band (healthy/bloodied/down) | S | [combat-tracker](specs/combat-tracker.md) | |
| Conditions with expiry | A | [combat-extras](specs/combat-extras.md) | |
| Concentration + save reminder on damage | A | [combat-extras](specs/combat-extras.md) | Notification with action |
| Round-based effect durations | A | [combat-extras](specs/combat-extras.md) | |
| Temp HP | A | [combat-extras](specs/combat-extras.md) | |
| Death saves | A | [combat-extras](specs/combat-extras.md) | |
| Add combatants mid-fight | A | [combat-extras](specs/combat-extras.md) | |
| **Hidden combatants** (stealthed) | A | [combat-extras](specs/combat-extras.md) | Added by DM |
| Drag to reorder initiative | B | [combat-extras](specs/combat-extras.md) | |
| Auto-roll attacks + hit/miss hint vs AC | S | [combat-tracker](specs/combat-tracker.md) | MVP per #74 (DM attack popup) |
| End-of-combat summary | B | [stats](specs/post-mvp/stats.md) | Plus campaign-wide stats; discuss after MVP |
| Legendary / lair actions | C | [combat-extras](specs/combat-extras.md) | |
| Reaction-used tracker | C | [combat-extras](specs/combat-extras.md) | |

**Attack flow (MVP, part of damage cards):** click attack; Shift = advantage, Ctrl = disadvantage; describe the action; DM applies via a card with normal / half / none / double and can override any value.

**Stats data capture (MVP):** track everything — all rolls, damage dealt/taken/healed, weapon used, overkill — so stats can be built later.

## 3. Character sheet and dice

| Feature | Tier | Spec | Notes |
|---|---|---|---|
| Advantage/disadvantage on any roll (toggle or Shift/Ctrl) | S | [dice-roll-log](specs/dice-roll-log.md) | Replaces inspiration toggle |
| Roll from any number on the sheet | A | [character-sheet-full](specs/character-sheet-full.md) | |
| **Dice notation in any free text is clickable** ("1d12+5", whitespace-tolerant; no `[[ ]]` needed): puts the dice in the 3D dice tray to adjust (dice, modifiers) before rolling; doesn't feed attack / apply | A | [dice-extras](specs/post-mvp/dice-extras.md) | **Very important** (DM, #188) |
| Saved macros / custom roll buttons | A | [dice-extras](specs/post-mvp/dice-extras.md) | |
| **3D dice roller** in a tray or over the battlemap; every roll in the app eventually goes through it | S | [dice-extras](specs/post-mvp/dice-extras.md) | Next dice work (DM, #188); result stays server-side; customisation (dice skins) later, tier B |
| Party portrait strip (BG2-style) | A | [theme-system](specs/post-mvp/theme-system.md) | Also a [play-shell](specs/play-shell.md) element |
| DM requests a roll from players | B | [dice-extras](specs/post-mvp/dice-extras.md) | Notification with roll action |
| Hidden DM rolls | S | [dice-roll-log](specs/dice-roll-log.md) | Via per-category public log settings (section 6) |
| Spell slots tracker | B | [character-sheet-full](specs/character-sheet-full.md) | |
| Party HP/AC summary for players | B | [play-shell](specs/play-shell.md) | Pairs with portrait strip |
| Player whispers roll to DM | C | [dice-extras](specs/post-mvp/dice-extras.md) | |
| Inventory weight / encumbrance | C | [character-sheet-full](specs/character-sheet-full.md) | |
| Short/long rest buttons | C | [character-sheet-full](specs/character-sheet-full.md) | |
| Inspiration toggle | D | — | Use advantage instead |
| D&D Beyond character import | F | — | |

## 4. Notes, handouts, world and party

| Feature | Tier | Spec | Notes |
|---|---|---|---|
| Handouts: DM reveals image/text to all or chosen players | A | [party-board](specs/post-mvp/party-board.md) | |
| Wikilinks between notes + backlinks | A | [world-builder](specs/post-mvp/world-builder.md) | Informs [ADR-0011](architecture/adr/0011-cross-references.md) |
| Party inventory with transfer to characters | A | [party-board](specs/post-mvp/party-board.md) | Grows from [party-loot](specs/party-loot.md) |
| Gold ledger with split-among-party | A (wallets + moves: S, #150) | [party-board](specs/post-mvp/party-board.md) | Grows from [party-loot](specs/party-loot.md) |
| NPC directory players build as they meet people | A | [world-builder](specs/post-mvp/world-builder.md) | Player-authored notes on revealed NPCs |
| Search / command palette (Obsidian / VS Code style) | A–B | [play-shell](specs/play-shell.md) | Search + commands in one palette |
| Journal entries with DM-only / player-visible sections | B | [world-builder](specs/post-mvp/world-builder.md) | |
| Map pins linked to notes/locations | B | [scene-tools](specs/scene-tools.md) | |
| Shared party notes | B | [party-board](specs/post-mvp/party-board.md) | |
| Session recap / journal | B | [campaign-manager](specs/post-mvp/campaign-manager.md) | See [ADR-0013](architecture/adr/0013-session-journal-scope.md) |
| Quest log with status | C | [world-builder](specs/post-mvp/world-builder.md) | |
| In-game calendar / time tracking | C | [campaign-manager](specs/post-mvp/campaign-manager.md) | |
| Text chat | C–D | [dice-roll-log](specs/dice-roll-log.md) | Only as part of the game log (Roll20-style): text and pasted descriptions alongside rolls. No separate chat. |
| Random tables | D | — | |

## 5. DM tools

| Feature | Tier | Spec | Notes |
|---|---|---|---|
| Scene list with folders; duplicate scene | S | [scenes-map](specs/scenes-map.md) | |
| **Multi-step undo** of combat log entries | S | [ADR-0016](architecture/adr/0016-domain-events-pending-actions.md) | DM-only, LIFO; damage/healing applied. Not rolls, moves or scene edits |
| Multiple enemy kinds in one encounter | S | [combat-tracker](specs/combat-tracker.md) | |
| Prepare scenes in background | A | [scenes-map](specs/scenes-map.md) | Likely near-free with active-scene model |
| Pause / intermission screen | A | [play-shell](specs/play-shell.md) | |
| Homebrew monster editor | A | [compendium](specs/post-mvp/compendium.md) | |
| Open5e / SRD monster import | A | [compendium](specs/post-mvp/compendium.md) | First real adapter ([ADR-0015](architecture/adr/0015-source-adapters-fixtures.md)) |
| Token art library, reuse across scenes | A | [assets-pipeline](specs/assets-pipeline.md) | Content-hashed store already dedupes |
| Monster stat block view on token click | B | [compendium](specs/post-mvp/compendium.md) | |
| Rules quick reference (DM screen) | B | [compendium](specs/post-mvp/compendium.md) | |
| Keyboard shortcuts | B | [play-shell](specs/play-shell.md) | Pairs with command palette |
| DM "view as player" | C | [play-shell](specs/play-shell.md) | Visibility filter makes this feasible |
| Backup / export UI | D | — | Copy SQLite file + asset dir |
| Revoke / rotate player links, kick | F | — | Trusted table |

## 6. Table-specific

| Feature | Tier | Spec | Notes |
|---|---|---|---|
| **BG2-style game log** in the play view ("Goblin attacks Mira: 12 + 4 = 16 — hit! 6 damage") | S | [dice-roll-log](specs/dice-roll-log.md) | Combat and out-of-combat rolls (e.g. contested Strength) |
| **DM per-category public/hidden log settings** (attack, damage, saves, checks…), changeable live | S | [dice-roll-log](specs/dice-roll-log.md) | Shieldmaiden-style tickboxes; broken there today |
| Live damage leaderboard + overkill callouts | A | [stats](specs/post-mvp/stats.md) | |
| Session awards (BG2-style: biggest hit, most damage taken…) | A | [stats](specs/post-mvp/stats.md) | |
| Kill-feed toasts ("Thorn finished the Ogre, overkill 37") | B | [stats](specs/post-mvp/stats.md) | Notification kind |
| Character trophy case (campaign stats on sheet) | B | [stats](specs/post-mvp/stats.md) | |
| Dice luck tracker (avg d20, nat 20s/1s) | B | [stats](specs/post-mvp/stats.md) | |
| Auto session recap from event log | D | — | Recaps are story, not combat |
| Live AI follow-along / summariser | F | — | Distinct from [agent-api](specs/post-mvp/agent-api.md) |
| Combat rewind / timeline replay | F | — | |
| External stream / overlay of the log | F | — | Log lives in the game client |
| **Homebrew gems** (Inspiration, Fortune, Combat, Divine Knowledge, Action): DM awards, player spends; reroll a d20, max damage dice | A | [gems](specs/post-mvp/gems.md) | Max 5 per character, not enforced (#140). MVP dice/combat interfaces allow it |

## 7. Prep, content and sources

| Feature | Tier | Spec | Notes |
|---|---|---|---|
| Scene prep in UI: upload map, grid calibration (size, offset, settings) | S | [scenes-map](specs/scenes-map.md) | |
| Drag tokens onto scene, rename, pick token art from uploads | S | [scenes-map](specs/scenes-map.md) | Full token library with folders: A |
| Hide / reveal token button (Owlbear-style) | S | [scenes-map](specs/scenes-map.md) | Hidden combatants follow |
| Pre-place encounter tokens on battlemap (some hidden) | S | [combat-tracker](specs/combat-tracker.md) | No auto-placement |
| Start / end encounter | S | [combat-tracker](specs/combat-tracker.md) | Unit of combat history |
| Fog of war with shape + polygon tools | A | [fog-of-war](specs/fog-of-war.md) | Not MVP; **first thing after** |
| Ctrl-D duplicate token (same definition), rename | S | [scenes-map](specs/scenes-map.md) | |
| Per-instance modifiers (temp HP, buffs/debuffs) | A | [combat-extras](specs/combat-extras.md) | No inline stat editing on instances |
| **Custom creature form** (Shieldmaiden-style), prefilled from a base | S | [combat-tracker](specs/combat-tracker.md) | Full editor (SRD base, custom actions) tier A |
| Search in creature picker | A | [combat-tracker](specs/combat-tracker.md) | MVP only if near-free |
| **One interface for adding any creature to an encounter** (SRD, custom, duplicated, fixture) | S | [combat-tracker](specs/combat-tracker.md) | Source-agnostic; see [ADR-0009](architecture/adr/0009-entity-content-model.md) |
| Custom NPC from SRD monster or existing NPC, then edit | A | [compendium](specs/post-mvp/compendium.md) | Shieldmaiden as reference |
| Custom actions auto-roll vs selected target(s) | A | [combat-extras](specs/combat-extras.md) | |
| Multi-target select | S (#148, see §8) | [combat-extras](specs/combat-extras.md) | |
| Open5e import | A | [compendium](specs/post-mvp/compendium.md) | Important |
| **AI paste** (paste text found online → prefilled creature/item form) | ? | [compendium](specs/post-mvp/compendium.md) | Form-filling time-saver, not an importer. > TODO (spec phase): tier |
| DM homebrew file import | A | [compendium](specs/post-mvp/compendium.md) | Formats TBD |
| Griffon's Saddlebag item import (partial mechanics) | B | [compendium](specs/post-mvp/compendium.md) | Fill in mechanics as items get used |
| 5etools import | C | [compendium-expansion](specs/post-mvp/compendium-expansion.md) | Separate project |
| Obsidian vault tie-in to notes | C | [obsidian-importer](specs/post-mvp/obsidian-importer.md) | Story/world-building |
| Agent features (NPC creation, map work, note grooming) | C | [agent-api](specs/post-mvp/agent-api.md) | Keep design SOLID: everything is a server command |
| Character builder (players create characters); full editing of PCs and NPCs, players fill in their own sheets | A (design for later, #154) | [levelling](specs/post-mvp/levelling.md) | MVP uses fixture characters; speed, scores and saves come from fixtures / the API until then |
| Import existing characters | C | — | Once-off scripts, way post-MVP |
| Session tracking | F | [ADR-0013](architecture/adr/0013-session-journal-scope.md) | Encounters instead |

## 8. DM feedback after the Combat build (#145)

Tiers confirmed by the DM (#148); details in [feedback-phase3](agents/feedback-phase3.md).

| Feature | Tier | Spec | Notes |
|---|---|---|---|
| Player turn alert: flash + default ping sound | S | [combat-tracker](specs/combat-tracker.md), [play-shell](specs/play-shell.md) | Sound per [ADR-0030](architecture/adr/0030-ui-notification-sounds.md) (amends ADR-0007) |
| DM-added alert sounds | A | [assets-pipeline](specs/assets-pipeline.md) | Small audio assets |
| Diagonal rule 5/10/5 (every second diagonal 10 ft) | S | [scenes-map](specs/scenes-map.md) | Decided #145; replaces 5 ft per diagonal (#124) |
| Movement tracker: speed on sheet; amber = dash, red = beyond dash (indicators only, never block); movement used this turn | S | [scenes-map](specs/scenes-map.md), [combat-tracker](specs/combat-tracker.md), [entities](specs/entities.md) | Supersedes the tier B "movement along drag path" row for the indicator part |
| Token shape setting: round crop or image as-is | S | [scenes-map](specs/scenes-map.md) | Default round |
| Drag images onto the battlemap (props, illustrations) | A | [scenes-map](specs/scenes-map.md) | Reserved props layer (FR-MAP-29) |
| Token indicators: removed from combat, down (0 HP) | S | [combat-tracker](specs/combat-tracker.md) | |
| Target from the map; multi-target (Ctrl/Shift) with per-target damage multiplier | S | [combat-tracker](specs/combat-tracker.md), [scenes-map](specs/scenes-map.md) | Promotes "Multi-target select" (tier A) |
| Box select on the map | S | [scenes-map](specs/scenes-map.md) | Group move: A |
| Party currency tracker (running coin total) | S | [party-loot](specs/party-loot.md) | Decided #146 |
| Character wallets (cp–pp per PC) + coin moves between party pot and wallets; DM moves any, a player moves from own wallet or takes from the pot; no below-zero guard | S | [party-loot](specs/party-loot.md) | Decided #150 |
| Sheet click-to-roll for 6 ability checks + 6 saves (stores ability scores + save proficiencies); Physical-dice mode visible on roll buttons | S | [character-sheet](specs/character-sheet.md), [dice-roll-log](specs/dice-roll-log.md) | Decided #149; skills stay A |

## Already decided elsewhere

| Feature | Tier | Ref |
|---|---|---|
| Dynamic lighting / vision | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Freehand drawing | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Audio (music, ambience, soundboard) | F | [ADR-0007](architecture/adr/0007-product-scope.md); UI notification sounds allowed by [ADR-0030](architecture/adr/0030-ui-notification-sounds.md) |
| Other game systems | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Fog, AoE props, status rings | C→ post-MVP, design for it | [scene-tools](specs/scene-tools.md) |
| Notes from tokens, player notes | post-MVP, design for it | [world-builder](specs/post-mvp/world-builder.md) |
