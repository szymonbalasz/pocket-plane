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
| HP bar/ring on token | A | [scene-tools](specs/post-mvp/scene-tools.md) | |
| Condition icons on token | A | [scene-tools](specs/post-mvp/scene-tools.md) | Needs conditions ([combat-extras](specs/post-mvp/combat-extras.md)) |
| Layers (map / objects / tokens / DM-only) | A | [scene-tools](specs/post-mvp/scene-tools.md) | DM-only layer ≈ hidden tokens |
| Doors and walls (block movement) | A | [scene-tools](specs/post-mvp/scene-tools.md) | Movement only; no vision ([ADR-0007](architecture/adr/0007-product-scope.md)) |
| Highlight current-turn token | B | [combat-tracker](specs/combat-tracker.md) | Initiative strip / portraits show whose turn in MVP; token highlight only if trivial |
| Movement measured along drag path, waypoints | B | [scenes-map](specs/scenes-map.md) | |

## 2. Combat

| Feature | Tier | Spec | Notes |
|---|---|---|---|
| **Encounter builder with CR difficulty** | S | [combat-tracker](specs/combat-tracker.md) | Needed to build the first MVP encounter |
| Roll initiative for all monsters in one click | S | [combat-tracker](specs/combat-tracker.md) | |
| Players see monster health as band (healthy/bloodied/down) | S | [combat-tracker](specs/combat-tracker.md) | |
| Conditions with expiry | A | [combat-extras](specs/post-mvp/combat-extras.md) | |
| Concentration + save reminder on damage | A | [combat-extras](specs/post-mvp/combat-extras.md) | Notification with action |
| Round-based effect durations | A | [combat-extras](specs/post-mvp/combat-extras.md) | |
| Temp HP | A | [combat-extras](specs/post-mvp/combat-extras.md) | |
| Death saves | A | [combat-extras](specs/post-mvp/combat-extras.md) | |
| Add combatants mid-fight | A | [combat-extras](specs/post-mvp/combat-extras.md) | |
| **Hidden combatants** (stealthed) | A | [combat-extras](specs/post-mvp/combat-extras.md) | Added by DM |
| Drag to reorder initiative | B | [combat-extras](specs/post-mvp/combat-extras.md) | |
| Auto-roll attacks + hit/miss hint vs AC | B | [combat-extras](specs/post-mvp/combat-extras.md) | Shieldmaiden-style attack flow is MVP (see below) |
| End-of-combat summary | B | [stats](specs/post-mvp/stats.md) | Plus campaign-wide stats; discuss after MVP |
| Legendary / lair actions | C | [combat-extras](specs/post-mvp/combat-extras.md) | |
| Reaction-used tracker | C | [combat-extras](specs/post-mvp/combat-extras.md) | |

**Attack flow (MVP, part of damage cards):** click attack; Shift = advantage, Ctrl = disadvantage; describe the action; DM applies via a card with normal / half / none / double and can override any value.

**Stats data capture (MVP):** track everything — all rolls, damage dealt/taken/healed, weapon used, overkill — so stats can be built later.

## 3. Character sheet and dice

| Feature | Tier | Spec | Notes |
|---|---|---|---|
| Advantage/disadvantage on any roll (toggle or Shift/Ctrl) | S | [dice-roll-log](specs/dice-roll-log.md) | Replaces inspiration toggle |
| Roll from any number on the sheet | A | [character-sheet-full](specs/post-mvp/character-sheet-full.md) | |
| Inline rolls in text (`[[1d20+5]]`) | A | [dice-extras](specs/post-mvp/dice-extras.md) | |
| Saved macros / custom roll buttons | A | [dice-extras](specs/post-mvp/dice-extras.md) | |
| 3D dice animation | A | [dice-extras](specs/post-mvp/dice-extras.md) | |
| Party portrait strip (BG2-style) | A | [theme-system](specs/post-mvp/theme-system.md) | Also a [play-shell](specs/play-shell.md) element |
| DM requests a roll from players | B | [dice-extras](specs/post-mvp/dice-extras.md) | Notification with roll action |
| Hidden DM rolls | B | [dice-extras](specs/post-mvp/dice-extras.md) | MVP rolls are public only |
| Spell slots tracker | B | [character-sheet-full](specs/post-mvp/character-sheet-full.md) | |
| Party HP/AC summary for players | B | [play-shell](specs/play-shell.md) | Pairs with portrait strip |
| Player whispers roll to DM | C | [dice-extras](specs/post-mvp/dice-extras.md) | |
| Inventory weight / encumbrance | C | [character-sheet-full](specs/post-mvp/character-sheet-full.md) | |
| Short/long rest buttons | C | [character-sheet-full](specs/post-mvp/character-sheet-full.md) | |
| Inspiration toggle | D | — | Use advantage instead |
| D&D Beyond character import | F | — | |

## 4. Notes, handouts, world and party

| Feature | Tier | Spec | Notes |
|---|---|---|---|
| Handouts: DM reveals image/text to all or chosen players | A | [party-board](specs/post-mvp/party-board.md) | |
| Wikilinks between notes + backlinks | A | [world-builder](specs/post-mvp/world-builder.md) | Informs [ADR-0011](architecture/adr/0011-cross-references.md) |
| Party inventory with transfer to characters | A | [party-board](specs/post-mvp/party-board.md) | Grows from [party-loot](specs/party-loot.md) |
| Gold ledger with split-among-party | A | [party-board](specs/post-mvp/party-board.md) | Grows from [party-loot](specs/party-loot.md) |
| NPC directory players build as they meet people | A | [world-builder](specs/post-mvp/world-builder.md) | Player-authored notes on revealed NPCs |
| Search / command palette (Obsidian / VS Code style) | A–B | [play-shell](specs/play-shell.md) | Search + commands in one palette |
| Journal entries with DM-only / player-visible sections | B | [world-builder](specs/post-mvp/world-builder.md) | |
| Map pins linked to notes/locations | B | [scene-tools](specs/post-mvp/scene-tools.md) | |
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

## Already decided elsewhere

| Feature | Tier | Ref |
|---|---|---|
| Dynamic lighting / vision | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Freehand drawing | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Audio | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Other game systems | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Fog, AoE props, status rings | C→ post-MVP, design for it | [scene-tools](specs/post-mvp/scene-tools.md) |
| Notes from tokens, player notes | post-MVP, design for it | [world-builder](specs/post-mvp/world-builder.md) |
