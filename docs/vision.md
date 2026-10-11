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

## The table today

Six windows, one game night:

| Window | Used for | Pain |
|---|---|---|
| Shieldmaiden (DM) | Prepared encounter, initiative, DM rolls, HP | Players read damage out loud; DM applies it by hand |
| Owlbear Rodeo (all) | Scene; each player controls own token; players place and transform props (status rings, AoE markers) | Separate from combat state |
| Discord | DM pastes one-off text | Outside the game |
| Miro (all) | Inventory | Separate tool |
| Physical dice (DM) | DM rolls | Not logged |
| Obsidian vault (DM) | Notes | Can't reach notes from what's on screen |

## Ideas raised

| Idea | Status |
|---|---|
| **One play page** (Roll20-style): canvas base, sticky-note windows pop out over it | MVP |
| **Damage cards:** player one-click rolls attack + damage → DM applies to a target as normal / resistant / immune / vulnerable | MVP (trial) |
| **Real dice:** every roll can be automated or entered manually, DM and players | MVP |
| **Notes from the canvas:** click a token (e.g. NPC) → its notes; DM notes on anything on screen | Post-MVP; design for it |
| **Player notes:** Obsidian-style personal notes with links, referenced from a widget or the whiteboard | Post-MVP; design for it |
| **Player-placed props:** status rings, AoE markers; move and transform | Post-MVP; design for it |
| **DM text drops** replacing Discord pastes | Post-MVP |
| **Timers and reminders** (concentration checks, effect durations) | Under discussion (event model) |

## Users

| User | Device | Needs |
|---|---|---|
| DM | Laptop, hosts the server | Run scenes and combat fast; control what players see; prep and reset test setups quickly |
| Player (~6) | Own laptop, remote, via player link | Their character sheet; roll dice; see the map, initiative and what the DM reveals |

## MVP: a playable session simulation

The DM can run a short session end to end — some roleplay, some story, some combat:

1. Players join via player links and see a **town scene** with map and tokens; move their own tokens.
2. DM switches the active scene to a **battlemap**.
3. Combat against **one kind of enemy**: initiative, attack rolls with one weapon each, damage, HP.
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
- The session simulation above runs start to finish with a DM and at least one player in separate browser sessions (e.g. normal + incognito, or two browsers) on one machine. Tunnel exposure is assumed solved, not an MVP check.
- Fixture rebuild: from empty DB to ready-to-play session in one command.
- Server killed mid-combat → restart → tokens, active scene, initiative, HP, roll log and loot log intact.
- A player joins from a player link with no setup beyond opening a URL.
- Every MVP feature develops and tests in an isolated worktree.

**Long-term**
- A full real session runs without Owlbear Rodeo or Shieldmaiden.
- DM preps encounters from imported compendium data without leaving the app.

> TODO (spec phase): confirm any numeric thresholds (rebuild time, reconnect time) with the DM.
