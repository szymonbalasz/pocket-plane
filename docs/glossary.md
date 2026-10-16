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
| **Instance** | A placed creature (token, combatant) pointing at one definition. Holds its own display name, read-only display copies of the definition (image, size; refreshed in the definition edit's transaction), play state and effects, which may carry modifiers ([ADR-0024](architecture/adr/0024-definition-visibility.md), decisions #126). | Creature definition |
| **Modifier** | A typed entry on an effect (bonus dice, flat bonus; later advantage / disadvantage, resistance, AC) applied by the server as a roll-time rider and named in the roll line ("+ 3 Bless"); never a derived value, so overrides still decide the base ([ADR-0038](architecture/adr/0038-effect-modifiers.md), refines ADR-0009). | Effect; Override |
| **Override** | A stored value that replaces a derived sheet value (fixed key list, e.g. `save.con`), with an optional note ([ADR-0036](architecture/adr/0036-full-sheet-derivation.md)). | Modifier |
| **Character** | Entity kind for a player character with a 5e character sheet (basics in MVP, full sheet later). Owned by a player. | Player |
| **Character sheet** | The 5e sheet view/data of a character. | — |
| **Draft** (character) | A player-created character the DM has not approved yet; editable by its owner, excluded from "whole party" encounters ([character-sheet-full](specs/character-sheet-full.md)). | — |
| **Sheet lock** | DM switch on a character: only the DM edits its sheet data; counters and play state stay usable by the owner. | — |
| **Sheet section** | A block another feature registers into the character sheet (slot header / vitals / main / tab) through the append-only `sheetSections` registry. | Window |
| **NPC sheet** | The character sheet opened by the DM on a custom creature definition for full editing. | `npc` entity kind |
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
| **Scene** | A map plus its grid, tokens, fog and scene-tool records (structure, props, templates). Players view the active scene. | Session |
| **Active scene** | The scene currently shown to players. | — |
| **Viewed scene** | The scene the DM's canvas shows: any scene, client-only; defaults to the active scene (decisions #122). | Active scene |
| **Scene folder** | DM-only, one-level grouping of scenes in the scene list. Never sent to players. | — |
| **Grid calibration** | Setting cell size/offset so the grid aligns with the map image. | — |
| **Token** | A movable piece on a scene: an instance of a creature definition, optionally bound to a combatant. | Combatant |
| **Token owner** | The one player (or none) who may move a token. Defaults from the character's owner; the DM reassigns it (decisions #124). | Character's owner |
| **Hidden token** | Token visible only to the DM (shown translucent to DM) until revealed with the hide/reveal button. MVP. | — |
| **Token shape** | How a token is drawn: round (circular crop), square, or none (image as is). Owned by the token; new tokens take the definition's default (decisions #148). | — |
| **Token label** | A token's name drawn on the grid line below it, on a layer above every token; overlay badges (e.g. Out) sit in the same row (decisions #172). | Movement indicator |
| **Selection** | The DM's client-only set of selected tokens on the viewed scene (click, Ctrl/Shift-click, box select); never sent. Features read it, e.g. to preselect attack targets (#148). | Target |
| **Box select** | DM Ctrl/Shift + drag on empty canvas: tokens whose footprint centre lies inside the box join the selection. | — |
| **Movement indicator** | Local drag label showing a move's distance against the token's speed (in combat: plus movement used); amber past speed, red past twice speed. Never blocks. | Ruler |
| **Fog** | Cells of a scene hidden from players, drawn by the DM with rectangle and polygon tools; tokens, props and DM templates wholly under it are filtered server-side ([fog-of-war](specs/fog-of-war.md), [ADR-0039](architecture/adr/0039-fog-visibility.md)). | Lighting (out of scope) |
| **Fog-hidden** | A record wholly under fog: its server-written `fogged` copy is true and players don't receive it (owned tokens excepted). | Hidden token |
| **Reveal all / Fog all** | DM fog actions that clear or cover a whole scene. | — |
| **AoE template** | A shape (cone, sphere, cylinder, cube, line) placed on a scene to show an area of effect; ephemeral unless kept ([scene-tools](specs/scene-tools.md)). | Freehand drawing (out of scope) |
| **Ephemeral template** | An AoE template sent as a live signal, gone when cleared or its placer leaves; **Keep** saves it as a record. | AoE template |
| **Prop** | A DM-placed image object on a scene's objects layer (barrel, table). | Token |
| **Wall** | A segment between grid vertices that blocks player token moves (no vision). | Door |
| **Door** | A wall segment the DM sets open, closed or locked; hidden from players while fully fogged. | Wall |
| **Structure** | A scene's walls and doors, stored as one record per scene. | — |
| **DM-only layer** | Records with the `hidden` flag (tokens, props, templates): drawn for the DM only. | Canvas layer |
| **Canvas layer** | A render slot in the canvas-layer registry (map, grid, props, structure, fog, templates, tokens, labels…), ordered by number. | DM-only layer |
| **Diagonal rule** | Campaign setting for distance on diagonals: 5/10/5 (default) or 5 ft. | — |
| **Move guard** | An append-only server check that may refuse a token move before it is written (walls, doors; [ADR-0040](architecture/adr/0040-token-move-guards.md)). | Token-changed hook |
| **Active-scene window** | The DM snapshot carries only the active scene's tokens and scene-tool records; other scenes load on view ([ADR-0041](architecture/adr/0041-active-scene-window.md)). | Windowed record type |
| **Ruler** | Measuring tool using 5/10/5 diagonals (every second diagonal costs 10 ft, decisions #145). | Movement indicator |
| **Ping** | Signal: a click shows a short pulse at a point to every other client showing that scene. | Pull |
| **Pull** | DM-only ping that also centres every player's camera on the point; players may pan away. | Ping |
| **Laser pointer** | Signal: a right-drag draws a trail that others see fade shortly after the last point. | Ping |
| **Drag preview** | Signal: others see a token move while it is dragged, without the movement label; never logged or persisted; a hidden token's drag reaches the DM only (decisions #171, #172). | Move (committed on drop) |
| **Player-ready indicator** | Shows the DM which players have fully loaded a scene. Post-MVP ([scene-tools](specs/scene-tools.md)); MVP assumes immediate load. | — |
| **Encounter** | A planned set of monsters with CR/difficulty math. Lifecycle: planned → started → ended. The unit of combat history. | Combat; session |
| **Combat** | The running state of a started encounter: initiative order, rounds, turns. | Encounter |
| **Combatant** | A participant in a combat, linked to an entity (and a token if on a scene). Holds HP and temp HP (for PCs, both live on the character); effects target the combatant (monsters) or the character (PCs). | Token; Entity |
| **Movement used** | Feet a combatant's token has moved since its turn started (5/10/5 per move, any mover); reset on Next. Indicator only. | Speed |
| **Turn alert** | The player client's alert (flash, ping, Toast) when one of its own PCs' turn starts. | Notification |
| **Initiative order** | Ordered list of combatants for the current combat. | — |
| **Condition** | A 5e condition (e.g. prone, poisoned; exhaustion with a level), stored as an Effect on a combatant or character. Reminder only, except incapacitating ones end concentration. | Effect |
| **Effect** | A row on a creature in play: a condition, a custom label, or a concentration; optional duration in rounds ([combat-extras](specs/combat-extras.md)); custom effects may carry modifiers ([effect-modifiers](specs/effect-modifiers.md)). | Modifier |
| **Preset** | A named effect template with modifiers (built-in, customised per campaign, or a character's own), e.g. Bless, Rage ([effect-modifiers](specs/effect-modifiers.md)). | Effect |
| **Toggle** | A character preset the owner or DM switches on / off, creating or ending its effect. | Preset |
| **Roll hook** | An append-only server registry entry that adds modifier parts to a roll inside the rolling command's transaction ([ADR-0038](architecture/adr/0038-effect-modifiers.md)). | Rule hook |
| **Concentration** | An Effect marking that a creature maintains a concentration spell (one per creature); damage raises a Concentration card. | — |
| **Concentration card** | A notification kind with a "Roll save" action (DC max(10, half the damage)) sent to the PC's owner or the DM. | Damage card |
| **Temp HP** | Temporary hit points on a character or combatant; absorb damage first, don't stack. | — |
| **Death save** | A PC's d20 roll at 0 HP; three successes = stable, three failures = dead (nat 1 = two failures, nat 20 = 1 HP). | — |
| **Rule hook** | A combat rule (expiry, concentration, death failures) run inside the causing command's transaction through `hpRules` / the `combatRuleHooks` registry ([ADR-0035](architecture/adr/0035-combat-rule-hooks.md)). | Listener |
| **Roll** | A dice expression evaluated server-side, with result. | — |
| **Game log** | Player-facing, BG2-style log window of rolls and combat outcomes (later also text). Each entry public or DM-only. Formerly "roll log". | Event log (internal) |
| **Roll category** | Kind of roll: attack, damage, saving throw, ability check, skill check, contested, initiative, healing, other. | — |
| **Public log settings** | DM's per-category tickboxes deciding which DM rolls appear in players' game log. Changeable live. | Visibility filter (the mechanism that applies them) |
| **Whisper** | A roll visible only to the roller and DM (or DM-to-player). | — |
| **Domain event** | Typed record of a committed change, dispatched in-process to listeners (broadcaster, rules…) ([ADR-0016](architecture/adr/0016-domain-events-pending-actions.md)). | WS event (the filtered message sent to a client) |
| **Notification** | Persisted, toast-like message with a history feed; has a kind, an audience and optionally an action ([ADR-0016](architecture/adr/0016-domain-events-pending-actions.md)). | WS event |
| **Event log** | Persisted, append-only log of every domain event; source for undo and stats ([ADR-0016](architecture/adr/0016-domain-events-pending-actions.md)). | Game log (player-facing) |
| **Undo** | Three kinds: **combat** (DM-only, strict LIFO over combat log entries: a compensating event reverses the latest apply and marks its entries undone); **fog** (DM, server-side per-scene stack, 20 steps, survives reload); **scene drawing** (DM, walls / props, client inverse intents, 50 per scene, lost on reload). | — |
| **Pending action** | A notification whose action (button) is not yet resolved or dismissed (e.g. apply damage, roll a save). | — |
| **Damage card** | A notification kind (`damage-card`) with an "apply" action, holding an attack's to-hit and damage rolls (from a player or DM roll) that the DM applies to one or more targets picked in the attack popup, each with its own hit / miss and multiplier: normal, half, none, double (#53, #134, #148). | Roll |
| **Attack + damage** | The sheet button that rolls to-hit and damage as one action; **Attack** rolls to-hit only and **Damage** damage only. In combat, Attack makes a to-hit-only damage card that Damage completes ([ADR-0037](architecture/adr/0037-split-attack-damage.md)). | Damage card |
| **HP formula** | Dice expression for a creature's hit points; Average = the stat block's HP max, Rolled = the formula rolled when the creature joins combat ([entities](specs/entities.md)). | — |
| **Action cue** | A few-second mark on a player's token on the DM's map when that player gets a pending action notification ([notifications](specs/notifications.md)). | Notification |
| **Attack popup** | The DM's non-modal panel to pick a damage card's targets (map selection or list), check hit vs AC per target, override values and apply. | Damage card |
| **Action owner** | Who may act on a pending notification (the DM or one player); the DM may always act. | Actor (a roll's actor in the game log) |
| **Combat log entry** | One applied HP change to one target in combat (damage or heal): the stats unit. Undo reverts one apply, which may hold several entries. | Game log entry; event log entry |
| **Health band** | healthy / bloodied / down: what players see of a monster's HP instead of numbers. | — |
| **Log entry** | One game-log line; may join several rolls (e.g. an attack's to-hit and damage). | Roll; event log entry |
| **Roll mode** | normal / advantage / disadvantage, applied to the d20. | — |
| **Physical-dice mode** | Per-browser toggle: every roll through the roll control asks for manual entry. | Manual roll |
| **Manual roll** | A roll entered from physical dice instead of rolled by the server. Logged and marked manual. | — |
| **Dice tray** | Window to compose or adjust a roll before rolling it; staged rolls and clicked notation land here ([dice-extras](specs/dice-extras.md)). | Roll control |
| **Throw** | The animation of one received `roll` entry (or all entries of one frame), settling on the server's faces; cosmetic only ([ADR-0044](architecture/adr/0044-3d-dice.md)). | Roll |
| **Dice look** | An owner's dice appearance (style, colours, material); everyone sees the roller's look. | — |
| **Dice style** | A named starting look (Ivory, Obsidian, …). | Preset (MOD) |
| **Notation link** | Dice notation in free text (e.g. "1d12 + 5") rendered clickable; stages a plain roll in the tray, never attack / apply. | — |
| **Party loot** | Shared, party-visible log of the party's coin and rewards: loot the DM gives, party spending, and coin moves between the party pot and wallets. | Party board (post-MVP superset) |
| **Loot entry** | One row of the party loot log: loot (text + signed coins, DM) or a coin move. | Loot row |
| **Party pot** | The party's shared coin per denomination, derived from the loot log. | Party purse, treasury |
| **Wallet** | One character's coin per denomination, derived from coin moves. | Purse |
| **Coin move** | A logged transfer of coin between the party pot, wallets and outside the party. | Transfer |

## Play page

| Term | Meaning | Not to be confused with |
|---|---|---|
| **Play page** | The one page per client: scene canvas as base layer, floating windows over it, top bar, launcher ([ADR-0025](architecture/adr/0025-play-shell-windows.md)). | — |
| **Window** | A floating, movable, resizable panel on the play page; an open instance of a window type. | Browser window (pop-outs out of scope) |
| **Window type** | A feature's registered kind of window (`<prefix>.<name>`, clients, defaults, component) in a per-client registry. | Window |
| **Launcher** | Bottom bar of buttons that open, bring to front or minimise windows. | — |
| **Minimised** (window) | Parked on the launcher: keeps its state and shows a dot when something new happens in it. A closed window keeps only its geometry ([play-shell](specs/play-shell.md)). | Closed |
| **Work area** | The part of the viewport below the top bar and above the launcher; windows and the attack popup fit into it (decisions #172). | Viewport |
| **Free area** | The largest part of the work area, right of the tool rail, that no open window covers; the map frames its tokens there (FR-SHELL-34, FR-MAP-44). | Work area |
| **Alert** | The shell's attention signal for one client: screen flash, short UI sound ([ADR-0030](architecture/adr/0030-ui-notification-sounds.md)) and a Toast; per-browser mute and volume. Not persisted. | Notification |
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
| **Signal** | Transient client-to-clients message (ping, laser, drag preview). Not a domain event: no DB write, event log or snapshot; still filtered (a signal type's audience may limit it to the DM, [ADR-0033](architecture/adr/0033-signal-audience.md)). |
| **Presence** | DM-only, in-memory view of which players are online. |
| **Sync probe** | Test-mode-only record type that proves visibility filtering end to end. |
| **Worktree** | An isolated git worktree where one agent works on one feature. |
| **Fixture** | Deterministic, disposable test data. Setups are scripts of server commands ([ADR-0017](architecture/adr/0017-agent-verification-fixture-library.md)). Not used for real play. |
| **Setup fixture** / **Reference fixture** | Setup: ordered server command steps. Reference: one import batch of reference content (e.g. SRD creatures). |
| **Fixture bundle** | Named composition of fixtures and other bundles; every bundle builds on `base`. |
| **Load manifest** | File in the data dir recording a fixture load: bundle, status, record IDs, URLs. |
| **Import batch** | Pipeline input: a source descriptor plus normalised records. |
| **Disposable** (data dir) | Data dir flagged safe to wipe and seed; required for reset, load and seeded IDs. |
