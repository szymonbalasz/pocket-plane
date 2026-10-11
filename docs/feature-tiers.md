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
| Encounter builder with CR difficulty | ? | [combat-extras](specs/post-mvp/combat-extras.md) | > TODO (spec phase): not yet ranked |

**Attack flow (MVP, part of damage cards):** click attack; Shift = advantage, Ctrl = disadvantage; describe the action; DM applies via a card with normal / half / none / double and can override any value.

**Stats data capture (MVP):** track everything — all rolls, damage dealt/taken/healed, weapon used, overkill — so stats can be built later.

## Already decided elsewhere

| Feature | Tier | Ref |
|---|---|---|
| Dynamic lighting / vision | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Freehand drawing | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Audio | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Other game systems | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Fog, AoE props, status rings | C→ post-MVP, design for it | [scene-tools](specs/post-mvp/scene-tools.md) |
| Notes from tokens, player notes | post-MVP, design for it | [world-builder](specs/post-mvp/world-builder.md) |
