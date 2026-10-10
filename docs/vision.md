# Vision

## Positioning

- Our own Roll20 / Fantasy Grounds, for **one table**: one DM, ~6 known remote players.
- Self-hosted on the DM's laptop, started at game time.
- Not a product. No signup, no multi-tenant SaaS, no marketplace.

## Replaces

| Today | Replaced by |
|---|---|
| Owlbear Rodeo (map / whiteboard) | [Scenes & map](specs/scenes-map.md) |
| Shieldmaiden (combat tracker) | [Combat tracker](specs/combat-tracker.md) |
| Miro (party board: items, handouts, shared info) | [Party board](specs/post-mvp/party-board.md) (post-MVP) |
| Obsidian vault (worldbuilding notes) | [Entities](specs/entities.md), gradually. **Not ported.** Optional [importer](specs/post-mvp/obsidian-importer.md) later. |

## Users

| User | Device | Needs |
|---|---|---|
| DM | Laptop, hosts the server | Prep world and encounters; run combat and maps fast; control what players see |
| Player (~6) | Own laptop, remote, via invite link | Their character sheet; roll dice; see the map, initiative and what the DM reveals |

## Rules system

- D&D 5e, 2014 SRD.
- External compendium import over time: Open5e first, 5etools-style JSON later.

## Non-goals

- Touch or mobile support.
- Dynamic lighting / line of sight.
- Freehand drawing (AoE props instead).
- Audio / music.
- Plugin or extension system.
- User accounts, roles, ACL framework.
- Cloud hosting or always-on service.
- Other game systems.

## Success criteria

> TODO (spec phase): confirm thresholds with the DM.

- A full session runs without Owlbear Rodeo or Shieldmaiden.
- Server crash mid-combat → restart → table resumes with tokens, fog, initiative, HP and roll log intact.
- A player joins from an invite link with no setup beyond opening a URL.
- DM can prep an encounter (monsters from compendium, map, tokens) without leaving the app.
- Any feature can be developed and tested in an isolated worktree in parallel with others.
