# Feature tiers

DM's ranking of features seen in Roll20, Foundry, Owlbear Rodeo etc. Source of truth for "is this in?" Feeds [ADR-0014](architecture/adr/0014-mvp-scope.md), the [roadmap](roadmap.md) and specs.

## Legend

| Tier | Meaning | Where it lands |
|---|---|---|
| **S** | Need it ASAP | MVP |
| **A** | Good to have soon | First post-MVP iterations |
| **B** | Lightweight, custom, slimmed-down version | Timing per item (see notes) |
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
| Highlight current-turn token | B | [combat-tracker](specs/combat-tracker.md) | > TODO (spec phase): MVP or later? |
| Movement measured along drag path, waypoints | B | [scenes-map](specs/scenes-map.md) | > TODO (spec phase): MVP or later? |

## Already decided elsewhere

| Feature | Tier | Ref |
|---|---|---|
| Dynamic lighting / vision | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Freehand drawing | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Audio | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Other game systems | F | [ADR-0007](architecture/adr/0007-product-scope.md) |
| Fog, AoE props, status rings | C→ post-MVP, design for it | [scene-tools](specs/post-mvp/scene-tools.md) |
| Notes from tokens, player notes | post-MVP, design for it | [world-builder](specs/post-mvp/world-builder.md) |
