# Glossary

Canonical terms. Use these exactly. To add or change a term, raise `Glossary: …` as an open question in your spec ([AGENTS.md §5](../AGENTS.md#5-where-to-write)).

## People and access

| Term | Meaning | Not to be confused with |
|---|---|---|
| **DM** | The single dungeon master. Holds the DM secret. Sees everything. | — |
| **Player** | A named participant in a campaign, identified by a player link. Not a user account. | Character (what the player plays) |
| **DM secret** | Credential that grants DM access to the server. | — |
| **Player link** | Per-player invite URL (public base URL + link token) bound to one player within one campaign; renaming the player keeps the token. Acts as the player's credential. | — |
| **Link token** | Opaque secret in a player link's path; the player's credential. | DM secret |
| **Public base URL** | External URL (usually the tunnel) used to build player links. | — |
| **DM client** | The client app used by the DM. Full controls. | — |
| **Player client** | The client app used by players. Restricted controls, filtered data. | — |

## Scope and content

| Term | Meaning | Not to be confused with |
|---|---|---|
| **Campaign** | Top-level scope. Every record belongs to exactly one campaign, except imported definitions, which are global ([ADR-0018](architecture/adr/0018-global-imported-content.md)). | Session |
| **Active campaign** | The one campaign the server serves to players; the DM switches it. | — |
| **Session** | One sitting of play (an evening). Informal only: **not tracked** by the app ([ADR-0013](architecture/adr/0013-session-journal-scope.md)). | Campaign; WS connection; encounter |
| **Entity** | A world record: NPC, monster, item, location, faction, quest, character. Campaign-owned, except imported definitions (global, [ADR-0018](architecture/adr/0018-global-imported-content.md)). Content model: [ADR-0009](architecture/adr/0009-entity-content-model.md). | Compendium entry |
| **Entity kind** | The type of an entity (npc, monster, item, location, faction, quest, character). MVP uses only **character** and **monster** ([ADR-0014](architecture/adr/0014-mvp-scope.md)). | — |
| **Creature definition** | What a creature *is*: stat block, actions. Imported (read-only) or custom (editable). Same shape for all sources ([ADR-0009](architecture/adr/0009-entity-content-model.md)). | Instance |
| **Derive** | Create a new, independent custom definition via the creature form, prefilled from a base (shortcut only; no ongoing link). | Duplicate (Ctrl-D on an instance) |
| **Instance** | A placed creature (token, combatant) pointing at one definition. Holds its own display name, read-only display copies of the definition (image, size; refreshed in the definition edit's transaction), play state and modifiers ([ADR-0024](architecture/adr/0024-definition-visibility.md), decisions #126). | Creature definition |
| **Modifier** | Per-instance adjustment applied on top of the definition (temp HP, buff, debuff). Tier A. | Override (not supported) |
| **Character** | Entity kind for a player character with a 5e character sheet (basics in MVP, full sheet later). Owned by a player. | Player |
| **Character sheet** | The 5e sheet view/data of a character. | — |
| **Compendium** | Library of rules content (monsters, spells, items…) from external sources or homebrew. Design is open ([ADR-0010](architecture/adr/0010-compendium-design.md)). | Entity |
| **Compendium entry** | One record in the compendium. | Entity |
| **Source** | Origin of imported data (e.g. fixtures, Open5e, 5etools JSON, homebrew), with licence/provenance. | Asset |
| **Adapter** | Bespoke code for one source that turns its data into normalised records for the import pipeline ([ADR-0015](architecture/adr/0015-source-adapters-fixtures.md)). | Import pipeline |
| **Import pipeline** | Fixed core: validate normalised records → upsert by (source, sourceKey) → provenance. Fed by adapters. | Adapter |
| **Clone** | A campaign-owned copy of a compendium entry, editable without affecting the original. | — |
| **Homebrew** | DM-authored content not from an external source. | — |
| **Gem** | Homebrew reward the DM awards to a character (Inspiration, Fortune, Combat, Divine Knowledge, Action); spent for an effect. Post-MVP ([gems](specs/post-mvp/gems.md)). | Homebrew |
| **Cross-reference** | A link from one entity/entry to another. Model is open ([ADR-0011](architecture/adr/0011-cross-references.md)). | — |
| **Asset** | An uploaded binary (map image, portrait, handout), stored content-hashed. | Entity |
| **Derivative** | A generated variant of an asset (thumbnail, resized, format-converted). | — |
| **Asset reference** | A record field holding an asset ID, set via `assets.require`; a player learns the ID only if they can see the field ([ADR-0023](architecture/adr/0023-asset-access-by-capability-id.md)). | Asset |

## Play

| Term | Meaning | Not to be confused with |
|---|---|---|
| **Scene** | A map plus its grid and tokens (fog and props post-MVP). Players view the active scene. | Session |
| **Active scene** | The scene currently shown to players. | — |
| **Viewed scene** | The scene the DM's canvas shows: any scene, client-only; defaults to the active scene (decisions #122). | Active scene |
| **Scene folder** | DM-only, one-level grouping of scenes in the scene list. Never sent to players. | — |
| **Grid calibration** | Setting cell size/offset so the grid aligns with the map image. | — |
| **Token** | A movable piece on a scene: an instance of a creature definition, optionally bound to a combatant. | Combatant |
| **Token owner** | The one player (or none) who may move a token. Defaults from the character's owner; the DM reassigns it (decisions #124). | Character's owner |
| **Hidden token** | Token visible only to the DM (shown translucent to DM) until revealed with the hide/reveal button. MVP. | — |
| **Fog** | Polygon regions hiding parts of a scene from players. | Lighting (out of scope) |
| **AoE prop** | A shape (cone, sphere, line, cube…) placed on a scene to show an area of effect. | Freehand drawing (out of scope) |
| **Ruler** | Measuring tool using 5e diagonal rules. | — |
| **Ping** | Signal: a click shows a short pulse at a point to every other client showing that scene. | Pull |
| **Pull** | DM-only ping that also centres every player's camera on the point; players may pan away. | Ping |
| **Laser pointer** | Signal: a right-drag draws a trail that others see fade shortly after the last point. | Ping |
| **Player-ready indicator** | Shows the DM which players have fully loaded a scene. Post-MVP ([scene-tools](specs/post-mvp/scene-tools.md)); MVP assumes immediate load. | — |
| **Encounter** | A planned set of monsters with CR/difficulty math. Lifecycle: planned → started → ended. The unit of combat history. | Combat; session |
| **Combat** | The running state of a started encounter: initiative order, rounds, turns. | Encounter |
| **Combatant** | A participant in a combat, linked to an entity (and a token if on a scene). Holds HP (for PCs, HP lives on the character), conditions, concentration. | Token; Entity |
| **Initiative order** | Ordered list of combatants for the current combat. | — |
| **Condition** | A 5e condition (e.g. prone, poisoned) applied to a combatant. | — |
| **Concentration** | Flag on a combatant maintaining a concentration spell; prompts a save on damage. | — |
| **Roll** | A dice expression evaluated server-side, with result. | — |
| **Game log** | Player-facing, BG2-style log window of rolls and combat outcomes (later also text). Each entry public or DM-only. Formerly "roll log". | Event log (internal) |
| **Roll category** | Kind of roll: attack, damage, saving throw, ability check, skill check, contested, initiative, healing, other. | — |
| **Public log settings** | DM's per-category tickboxes deciding which DM rolls appear in players' game log. Changeable live. | Visibility filter (the mechanism that applies them) |
| **Whisper** | A roll visible only to the roller and DM (or DM-to-player). | — |
| **Domain event** | Typed record of a committed change, dispatched in-process to listeners (broadcaster, rules…) ([ADR-0016](architecture/adr/0016-domain-events-pending-actions.md)). | WS event (the filtered message sent to a client) |
| **Notification** | Persisted, toast-like message with a history feed; has a kind, an audience and optionally an action ([ADR-0016](architecture/adr/0016-domain-events-pending-actions.md)). | WS event |
| **Event log** | Persisted, append-only log of every domain event; source for undo and stats ([ADR-0016](architecture/adr/0016-domain-events-pending-actions.md)). | Game log (player-facing) |
| **Undo** | DM-only, strict LIFO, combat log entries only (damage/healing applied): appends a compensating event that reverses the latest entry and marks it undone. | — |
| **Pending action** | A notification whose action (button) is not yet resolved or dismissed (e.g. apply damage, roll a save). | — |
| **Damage card** | A notification kind (`damage-card`) with an "apply" action, holding an attack's to-hit and damage rolls (from a player or DM roll) that the DM applies to a target picked in the attack popup, with a multiplier: normal, half, none, double (#53, #134). | Roll |
| **Attack popup** | The DM's dialog to pick a damage card's target, check hit vs AC, override values and apply. | Damage card |
| **Action owner** | Who may act on a pending notification (the DM or one player); the DM may always act. | Actor (a roll's actor in the game log) |
| **Combat log entry** | One applied HP change in combat (damage or heal): the undo and stats unit. | Game log entry; event log entry |
| **Health band** | healthy / bloodied / down: what players see of a monster's HP instead of numbers. | — |
| **Log entry** | One game-log line; may join several rolls (e.g. an attack's to-hit and damage). | Roll; event log entry |
| **Roll mode** | normal / advantage / disadvantage, applied to the d20. | — |
| **Physical-dice mode** | Per-browser toggle: every roll through the roll control asks for manual entry. | Manual roll |
| **Manual roll** | A roll entered from physical dice instead of rolled by the server. Logged and marked manual. | — |
| **Party loot** | Shared, party-visible log of rewards (gold, items) the DM gives the party. | Party board (post-MVP superset) |

## Play page

| Term | Meaning | Not to be confused with |
|---|---|---|
| **Play page** | The one page per client: scene canvas as base layer, floating windows over it, top bar, launcher ([ADR-0025](architecture/adr/0025-play-shell-windows.md)). | — |
| **Window** | A floating, movable, resizable panel on the play page; an open instance of a window type. | Browser window (pop-outs out of scope) |
| **Window type** | A feature's registered kind of window (`<prefix>.<name>`, clients, defaults, component) in a per-client registry. | Window |
| **Launcher** | Bottom bar of buttons that open, bring to front or minimise windows. | — |
| **Layout** | Every window's state, geometry and z-order for one (campaign, owner); stored only in browser `localStorage` (decisions #121). | — |

## System

| Term | Meaning |
|---|---|
| **Intent** | A client request to change state. Server validates, then mutates. |
| **Event** (WS event) | Server-to-client message carrying the filtered record changes (one or more records) of one domain event; produced after the visibility filter. |
| **Record change** | One record's change inside a domain event (before/after); sent to clients as `upsert` or `delete` after filtering. |
| **Visibility filter** | Server-side rule deciding which events/fields each client receives. |
| **Snapshot** | Full filtered state sent by the server after `hello` and on resync. |
| **Resync** | Replacing a client's whole state with a fresh snapshot (client request, sequence gap or active-scene switch). |
| **Signal** | Transient client-to-clients message (ping, laser). Not a domain event: no DB, event log or snapshot; still filtered. |
| **Presence** | DM-only, in-memory view of which players are online. |
| **Sync probe** | Test-mode-only record type that proves visibility filtering end to end. |
| **Worktree** | An isolated git worktree where one agent works on one feature. |
| **Fixture** | Deterministic, disposable test data. Setups are scripts of server commands ([ADR-0017](architecture/adr/0017-agent-verification-fixture-library.md)). Not used for real play. |
| **Setup fixture** / **Reference fixture** | Setup: ordered server command steps. Reference: one import batch of reference content (e.g. SRD creatures). |
| **Fixture bundle** | Named composition of fixtures and other bundles; every bundle builds on `base`. |
| **Load manifest** | File in the data dir recording a fixture load: bundle, status, record IDs, URLs. |
| **Import batch** | Pipeline input: a source descriptor plus normalised records. |
| **Disposable** (data dir) | Data dir flagged safe to wipe and seed; required for reset, load and seeded IDs. |
