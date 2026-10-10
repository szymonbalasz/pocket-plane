# Glossary

Canonical terms. Use these exactly. To add or change a term, raise `Glossary: …` as an open question in your spec ([AGENTS.md §5](../AGENTS.md#5-where-to-write)).

## People and access

| Term | Meaning | Not to be confused with |
|---|---|---|
| **DM** | The single dungeon master. Holds the DM secret. Sees everything. | — |
| **Player** | A named participant in a campaign, identified by a player link. Not a user account. | Character (what the player plays) |
| **DM secret** | Credential that grants DM access to the server. | — |
| **Player link** | Per-player invite URL bound to one player name within one campaign. Acts as the player's credential. | — |
| **DM client** | The client app used by the DM. Full controls. | — |
| **Player client** | The client app used by players. Restricted controls, filtered data. | — |

## Scope and content

| Term | Meaning | Not to be confused with |
|---|---|---|
| **Campaign** | Top-level scope. Every record belongs to exactly one campaign. | Session |
| **Session** | One sitting of play (an evening). Journal/outcomes scope is open ([ADR-0013](architecture/adr/0013-session-journal-scope.md)). | Campaign; WS connection |
| **Entity** | A campaign-owned world record: NPC, monster, item, location, faction, quest, character. Content model is open ([ADR-0009](architecture/adr/0009-entity-content-model.md)). | Compendium entry |
| **Entity kind** | The type of an entity (npc, monster, item, location, faction, quest, character). MVP uses only **character** and **monster** ([ADR-0014](architecture/adr/0014-mvp-scope.md)). | — |
| **Character** | Entity kind for a player character with a 5e character sheet (basics in MVP, full sheet later). Owned by a player. | Player |
| **Character sheet** | The 5e sheet view/data of a character. | — |
| **Compendium** | Library of rules content (monsters, spells, items…) from external sources or homebrew. Design is open ([ADR-0010](architecture/adr/0010-compendium-design.md)). | Entity |
| **Compendium entry** | One record in the compendium. | Entity |
| **Source** | Origin of imported data (e.g. fixtures, Open5e, 5etools JSON, homebrew), with licence/provenance. | Asset |
| **Adapter** | Code that loads one source into the app: fetch → normalise → upsert with provenance ([ADR-0015](architecture/adr/0015-source-adapters-fixtures.md), proposed). | — |
| **Clone** | A campaign-owned copy of a compendium entry, editable without affecting the original. | — |
| **Homebrew** | DM-authored content not from an external source. | — |
| **Cross-reference** | A link from one entity/entry to another. Model is open ([ADR-0011](architecture/adr/0011-cross-references.md)). | — |
| **Asset** | An uploaded binary (map image, portrait, handout), stored content-hashed. | Entity |
| **Derivative** | A generated variant of an asset (thumbnail, resized, format-converted). | — |

## Play

| Term | Meaning | Not to be confused with |
|---|---|---|
| **Scene** | A map plus its grid and tokens (fog and props post-MVP). Players view the active scene. | Session |
| **Active scene** | The scene currently shown to players. | — |
| **Grid calibration** | Setting cell size/offset so the grid aligns with the map image. | — |
| **Token** | A movable piece on a scene, bound to an entity and optionally a combatant. | Combatant |
| **Hidden token** | Token visible only to the DM. | — |
| **Fog** | Polygon regions hiding parts of a scene from players. | Lighting (out of scope) |
| **AoE prop** | A shape (cone, sphere, line, cube…) placed on a scene to show an area of effect. | Freehand drawing (out of scope) |
| **Ruler** | Measuring tool using 5e diagonal rules. | — |
| **Player-ready indicator** | Shows the DM which players are ready. Part of combat in MVP; exact meaning open ([combat-tracker](specs/combat-tracker.md#15-open-questions)). | — |
| **Encounter** | A planned set of combatants with CR/difficulty math, prepared before combat. | Combat |
| **Combat** | A running encounter: initiative order, rounds, turns. | Encounter |
| **Combatant** | A participant in a combat, linked to an entity (and a token if on a scene). Holds HP, conditions, concentration. | Token; Entity |
| **Initiative order** | Ordered list of combatants for the current combat. | — |
| **Condition** | A 5e condition (e.g. prone, poisoned) applied to a combatant. | — |
| **Concentration** | Flag on a combatant maintaining a concentration spell; prompts a save on damage. | — |
| **Roll** | A dice expression evaluated server-side, with result. | — |
| **Roll log** | Persisted, ordered list of rolls in a campaign. | — |
| **Whisper** | A roll visible only to the roller and DM (or DM-to-player). | — |
| **Party loot** | Shared, party-visible log of rewards (gold, items) the DM gives the party. | Party board (post-MVP superset) |

## System

| Term | Meaning |
|---|---|
| **Intent** | A client request to change state. Server validates, then mutates. |
| **Event** | Server-to-client message describing a change to one record. |
| **Visibility filter** | Server-side rule deciding which events/fields each client receives. |
| **Snapshot** | Full filtered state a client requests on (re)connect. |
| **Worktree** | An isolated git worktree where one agent works on one feature. |
| **Fixture** | Deterministic seed data used by tests and dev; loaded as a source via an adapter (proposed, [ADR-0015](architecture/adr/0015-source-adapters-fixtures.md)). |
