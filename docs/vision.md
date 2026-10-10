# Vision

## Positioning

- Our own Roll20 / Fantasy Grounds, for **one table**: one DM, ~6 known remote players.
- Self-hosted on the DM's laptop, started at game time.
- Not a product. No signup, no multi-tenant SaaS, no marketplace.
- **Get a usable product into the DM's hands early, then iterate** ([ADR-0014](architecture/adr/0014-mvp-scope.md)).

## Replaces (long-term)

| Today | Replaced by |
|---|---|
| Owlbear Rodeo (map / whiteboard) | [Scenes & map](specs/scenes-map.md), later [scene tools](specs/post-mvp/scene-tools.md) |
| Shieldmaiden (combat tracker) | [Combat tracker](specs/combat-tracker.md), later [combat extras](specs/post-mvp/combat-extras.md) |
| Miro (party board: items, handouts, shared info) | [Party loot](specs/party-loot.md) (MVP), then [party board](specs/post-mvp/party-board.md) |
| Obsidian vault (worldbuilding notes) | [World builder](specs/post-mvp/world-builder.md), gradually. **Not ported.** Optional [importer](specs/post-mvp/obsidian-importer.md) later. |

## Users

| User | Device | Needs |
|---|---|---|
| DM | Laptop, hosts the server | Run scenes and combat fast; control what players see; prep and reset test setups quickly |
| Player (~6) | Own laptop, remote, via player link | Their character sheet; roll dice; see the map, initiative and what the DM reveals |

## MVP: a playable session simulation

The DM can run a short session end to end — some roleplay, some story, some combat:

1. Players join via player links and see a **town scene** with map and tokens; move their own tokens.
2. DM switches the active scene to a **battlemap**.
3. Combat against **one kind of enemy**: initiative, attack rolls with one weapon each, damage, HP. Player-ready indicator before/at combat start.
4. DM gives a reward to the party; it shows in a shared **party loot** log.
5. Everything above can be torn down and rebuilt from **fixtures** (one player, one enemy, two scenes).

## Working goals

- **Fixtures everywhere** — rebuild any dev/test setup from scratch in seconds ([ADR-0008](architecture/adr/0008-parallel-dev-isolation.md)).
- **Adapters for sources** — automate import of reference material (Open5e, 5etools JSON, homebrew, …) through one pipeline ([ADR-0015](architecture/adr/0015-source-adapters-fixtures.md), proposed).

## Rules system

- D&D 5e, 2014 SRD.
- External compendium import post-MVP: Open5e first, 5etools-style JSON later.

## Non-goals

- Touch or mobile support.
- Dynamic lighting / line of sight.
- Freehand drawing (AoE props instead, post-MVP).
- Audio / music.
- Plugin or extension system.
- User accounts, roles, ACL framework.
- Cloud hosting or always-on service.
- Other game systems.

## Success criteria

**MVP**
- The session simulation above runs start to finish with a DM and at least one player on separate laptops via the tunnel.
- Fixture rebuild: from empty DB to ready-to-play session in one command.
- Server killed mid-combat → restart → tokens, active scene, initiative, HP, roll log and loot log intact.
- A player joins from a player link with no setup beyond opening a URL.
- Every MVP feature develops and tests in an isolated worktree.

**Long-term**
- A full real session runs without Owlbear Rodeo or Shieldmaiden.
- DM preps encounters from imported compendium data without leaving the app.

> TODO (spec phase): confirm any numeric thresholds (rebuild time, reconnect time) with the DM.
