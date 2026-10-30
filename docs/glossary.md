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
| **Session** | One sitting of play (an evening). **Not stored** by the app ([ADR-0013](architecture/adr/0013-session-journal-scope.md)); stats derive it from the log: a gap of ≥ 6 h starts a new one ([stats](specs/stats.md), #315). | Campaign; WS connection; encounter |
| **Entity** | A world record: NPC, monster, item, location, faction, quest, character. Campaign-owned, except imported definitions (global, [ADR-0018](architecture/adr/0018-global-imported-content.md)). Content model: [ADR-0009](architecture/adr/0009-entity-content-model.md). | Compendium entry |
| **Entity kind** | The type of an entity (npc, monster, item, location, faction, quest, character). MVP uses only **character** and **monster** ([ADR-0014](architecture/adr/0014-mvp-scope.md)). | — |
| **Creature definition** | What a creature *is*: stat block, actions. Imported (read-only) or custom (editable). Same shape for all sources ([ADR-0009](architecture/adr/0009-entity-content-model.md)). | Instance |
| **Creature type** | A monster's SRD type (one of 14, e.g. humanoid) in its stat block; picks its token art. Tokens carry a display copy ([ADR-0050](architecture/adr/0050-token-creature-type.md), [entities](specs/entities.md)). | Entity kind |
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
| **Custom creature** | A custom monster definition together with its NPC sheet; what the MCP server's `creature_*` tools create, derive and edit ([agent-api](specs/agent-api.md)). | `npc` entity kind; imported definition |
| **Mount** | Two custom creatures, rider and mount, linked by a "Mount: …" / "Rider: …" line in each one's notes; no link record ([agent-api](specs/agent-api.md)). | Companion |
| **Compendium** | Global library of rules content (monsters, spells, items, conditions, class features) from bundled sources or homebrew; read on demand, never in the snapshot ([compendium](specs/compendium.md), [ADR-0046](architecture/adr/0046-compendium-scope.md)). | Entity |
| **Compendium entry** | One record in the compendium. | Entity |
| **Search group** | Compendium entries with the same kind, name and source, shown as one expandable search row ([compendium](specs/compendium.md)). | — |
| **Source** | Origin of imported data (e.g. fixtures, Open5e, 5etools JSON, homebrew), with licence/provenance. | Asset |
| **Book** | One 5etools source (a book or adventure abbreviation, e.g. MM), imported as one compendium source `5et-<abbr>` ([compendium-expansion](specs/post-mvp/compendium-expansion.md)). | Source |
| **Replaced entry** | An imported compendium entry that another imported entry `replaces` (its SRD copy, or a reprint's original): hidden from search, still readable by id ([ADR-0074](architecture/adr/0074-user-supplied-sources.md)). | Superseded entry |
| **Source rank** | Order of sources on equal search tiers: own, bundled, other imported, fixture ([compendium](specs/compendium.md)). | — |
| **Adapter** | Bespoke code for one source that turns its data into normalised records for the import pipeline ([ADR-0015](architecture/adr/0015-source-adapters-fixtures.md)). | Import pipeline |
| **Import pipeline** | Fixed core: validate normalised records → upsert by (source, sourceKey) → provenance. Fed by adapters. | Adapter |
| **Clone** | A campaign-owned copy of a compendium entry, editable without affecting the original; for monsters the clone is a derived custom definition (Derive). | — |
| **Bundled source** | A recorded copy of an external source shipped in the repo (e.g. SRD 5.1 from Open5e, `wotc-srd` only) and imported offline. | — |
| **Homebrew** | DM-authored content not from an external source. | — |
| **Gem** | Homebrew reward the DM awards to a character (Inspiration, Fortune, Combat, Divine Knowledge, Action); the player spends one for an effect (a public log line). An optional feature, **off by default** per campaign ([gems](specs/gems.md), #312). "Max 5" is a label, not enforced (#315). | Homebrew; D&D Inspiration |
| **Feature switch** | A per-campaign on / off for an optional feature (gems first). While off, nothing tagged with the feature reaches any client or stats read; its rows are kept ([ADR-0058](architecture/adr/0058-feature-switches.md)). | Preference (per person) |
| **Reroll** | An Inspiration gem spend: a new roll replaces one d20 roll from the log; the old entry stays, struck through, marked superseded ([dice-roll-log](specs/dice-roll-log.md)). | Undo |
| **Superseded entry** | A game-log entry replaced by a reroll: kept (append-only), marked once with `supersededBy`; stats count only the final roll. | Undone entry |
| **Maxed die** | A damage die a Combat gem set to its maximum on a pending damage card; the card total is recomputed on the server ([combat-tracker](specs/combat-tracker.md)). | Critical hit |
| **Cross-reference** | A link from one entity/entry to another. Model is open ([ADR-0011](architecture/adr/0011-cross-references.md)). | — |
| **Asset** | An uploaded binary (map image, portrait, handout), stored content-hashed. | Entity |
| **Derivative** | A generated variant of an asset (thumbnail, resized, format-converted). | — |
| **Asset reference** | A record field holding an asset ID, set via `assets.require`; a player learns the ID only if they can see the field ([ADR-0023](architecture/adr/0023-asset-access-by-capability-id.md)). | Asset |
| **Image tag** | A DM-only label on an image (built-ins Tokens, Portraits, Maps, Handouts, Props, Items, plus the DM's own; ≤ 8 per image) used to filter pickers ([assets-pipeline](specs/assets-pipeline.md)). | Search group |
| **Shared matcher** | The one search matcher (`@shared/search/match`): whitespace-separated terms, partial, case-insensitive, all must match; used by the compendium and every image picker. | Source rank |

## Play

| Term | Meaning | Not to be confused with |
|---|---|---|
| **Scene** | A map plus its grid, tokens, fog and scene-tool records (structure, props, templates). Players view the active scene. | Session |
| **Overview** | The second kind of scene, for the zoomed-out parts of the game (a region, a city): an empty canvas of images, place labels and miniatures, placed anywhere; no grid, fog, walls or combat ([overview-scenes](specs/overview-scenes.md)). | Battle scene (the map-and-grid kind) |
| **Overview item** | One thing on an overview: an image, a place label or a miniature. | Prop, Token |
| **Place label** | An overview item: one line of text with an optional dot, each with its own colour and stroke; shrinks with the map. | Token label |
| **Miniature** | An overview item: a picture with a name that a player may own and move. No creature, vision, HP or initiative behind it; a party miniature links to its character for name, art and owner only. | Token |
| **Active scene** | The scene currently shown to players. While an overview is shown there is none; the sync layer's active-scene resolver then returns the overview's ID ([ADR-0075](architecture/adr/0075-overview-scenes.md)). | — |
| **Viewed scene** | The scene the DM's canvas shows: any scene, client-only; defaults to the active scene (decisions #122). | Active scene |
| **Scene folder** | DM-only, one-level grouping of scenes in the scene list. Never sent to players. | — |
| **Grid calibration** | Setting cell size/offset so the grid aligns with the map image. | — |
| **Token** | A movable piece on a scene: an instance of a creature definition, optionally bound to a combatant. | Combatant |
| **Token owner** | The one player (or none) who may move a token. Defaults from the character's owner; the DM reassigns it (decisions #124). A companion's token follows its owner ([ADR-0056](architecture/adr/0056-companion-visibility.md)). | Character's owner |
| **Reveal refit** | A player's map re-frames once when tokens they see for the first time land under a window or off-screen, unless they moved the camera; a pan cancels it, a drag defers it ([scenes-map](specs/scenes-map.md) FR-MAP-82). | Fit |
| **Hidden token** | Token visible only to the DM (shown translucent to DM) until revealed with the hide/reveal button. MVP. | — |
| **Token shape** | How a token is drawn: round (circular crop), square, or none (image as is). Owned by the token; new tokens take the definition's default (decisions #148). | — |
| **Token art** | The glyph on its creature type's colour, drawn for a token without an image; the DM can switch a token to initials ([entities](specs/entities.md), [ADR-0050](architecture/adr/0050-token-creature-type.md)). | Token shape |
| **Token label** | A token's name drawn on the grid line below it, on a layer above every token; overlay badges (e.g. Out) sit in the same row (decisions #172). | Movement indicator |
| **Selection** | The DM's client-only set of selected tokens on the viewed scene (click, Ctrl/Shift-click, box select); never sent. Features read it, e.g. to preselect attack targets (#148). | Target |
| **Box select** | DM Ctrl/Shift + drag on empty canvas: tokens whose footprint centre lies inside the box join the selection. | — |
| **Movement indicator** | Local drag label showing a move's distance against the token's speed (in combat: plus movement used); amber past speed, red past twice speed. Never blocks. | Ruler |
| **Fog** | Areas of a scene hidden from players: freeform shapes (rectangle, polygon, circle; grid snap unless Ctrl) over a base cell mask; pierced by vision; records a player can't see are filtered server-side ([fog-of-war](specs/fog-of-war.md), [ADR-0042](architecture/adr/0042-dynamic-vision.md)). | Lighting (out of scope) |
| **Explored** | Map visible, records on it hidden: a player's remembered area (per player, per-map toggle) or a DM drawing mode. | Fog |
| **Magical darkness** | DM-placed shapes that block all player sight unless the source sees through magical darkness. | Fog |
| **Vision source** | A player-owned token whose sight reveals fog for that player (≤ 4 per player; ≤ 12 for the party while party vision is on). | — |
| **Sight** | A vision source's visibility polygon, cut by walls, closed doors, darkness and the map's edges, within its vision / darkvision radius. | — |
| **Normal vision** | Vision radius 999 ft, used when a creature's senses don't set one; only blinding effects reduce it ([ADR-0047](architecture/adr/0047-party-vision.md)). | Darkvision |
| **Party vision** | A campaign switch (off by default): every player sees what any player sees ([ADR-0047](architecture/adr/0047-party-vision.md)). | View as |
| **Sight preview** | While a source token is dragged, its sight at each previewed cell, computed by the server; map only, records follow on the drop; never logged ([fog-of-war](specs/fog-of-war.md)). | Drag preview |
| **Fog brush** | DM fog shape: a radius painted along the pointer, grid-snapped unless Ctrl ([fog-of-war](specs/fog-of-war.md)). | — |
| **Darkvision** | A second, larger sight radius; the darkvision-only ring is drawn dimmed and grey (no lighting model). | — |
| **Sees through magical darkness** | Sheet sense (e.g. Devil's Sight): darkness doesn't block this source's sight; drawn as a darker transparent overlay. | — |
| **Blind (dark screen)** | A player whose every source stands in darkness without see-through, or is Blinded, sees only own tokens and the grid. | — |
| **Seen by** | Server-written per-player copy on a record (`seenBy`): which players see it; never on the wire. | Fogged |
| **View as** | DM preview of one player's view, loaded on demand. | — |
| **Invisible** | DM-only token state, distinct from Hidden and from the Invisible condition: only players whose source has Sees invisible (and sight on the token) receive it; the party still sees invisible PCs (#210). | Hidden token; condition |
| **Sees invisible** | DM-only sheet sense (truesight, See Invisibility). | — |
| **Fog-hidden** | A record a given player can't see (not in their sight or clear area): not in that player's `seenBy`, so they don't receive it (owned / party tokens excepted). `fogged` = seen by no player. | Hidden token |
| **Reveal all / Fog all** | DM fog actions that clear or cover a whole scene. | — |
| **AoE template** | A shape (cone, sphere, cylinder, cube, line) placed on a scene to show an area of effect, placed freely (Ctrl) or snapped; its affected squares are the cells more than half inside it; ephemeral unless kept ([scene-tools](specs/scene-tools.md)). | Freehand drawing (out of scope) |
| **Affected squares** | The grid cells more than half inside an AoE template ([scene-tools](specs/scene-tools.md)). | — |
| **Ephemeral template** | An AoE template sent as a live signal, gone when cleared or its placer leaves; **Keep** saves it as a record. | AoE template |
| **Prop** | A DM-placed image object on a scene's objects layer (barrel, table). | Token |
| **Wall** | A segment between two points (grid vertices, or free with Ctrl) that blocks player token moves and sight. | Door |
| **Wall hint** | The red piece of the first wall crossed, shown while a player drags a token (from a server dry-run check). | — |
| **Door** | A wall segment the DM sets open, closed or locked; closed / locked doors block sight; hidden from a player until a point beside it is in their sight. | Wall |
| **Structure** | A scene's walls and doors, stored as one record per scene. | — |
| **DM-only layer** | Records with the `hidden` flag (tokens, props, templates): drawn for the DM only. | Canvas layer |
| **Canvas layer** | A render slot in the canvas-layer registry (map, grid, props, structure, fog, templates, tokens, labels…), ordered by number. | DM-only layer; Konva layer group |
| **Konva layer group** | One of the canvas's four drawing surfaces (`base` / `fog` / `objects` / `top`); canvas layers render as groups inside them ([fog-of-war](specs/fog-of-war.md)). | Canvas layer |
| **Diagonal rule** | Campaign setting for distance on diagonals: 5/10/5 (default) or 5 ft. | — |
| **Move guard** | An append-only server check that may refuse a token move before it is written (walls, doors; [ADR-0040](architecture/adr/0040-token-move-guards.md)). | Token-changed hook |
| **Active-scene window** | The DM snapshot carries only the active scene's tokens and scene-tool records; other scenes load on view ([ADR-0041](architecture/adr/0041-active-scene-window.md)). | Windowed record type |
| **Ruler** | Measuring tool using 5/10/5 diagonals (every second diagonal costs 10 ft, decisions #145). | Movement indicator |
| **Ping** | Signal: a click shows a short pulse at a point to every other client showing that scene. | Pull |
| **Pull** | DM-only ping that also centres every player's camera on the point; players may pan away. | Ping |
| **Laser pointer** | Signal: a right-drag draws a trail that others see fade shortly after the last point. | Ping |
| **Drag preview** | Signal: others see a token move while it is dragged, without the movement label; never logged or persisted; a hidden token's drag reaches the DM only (decisions #171, #172). | Move (committed on drop) |
| **Drag path** | The cells a dragged token steps through on the straight line its distance counts; players' tokens' paths go to everyone who sees them, others' to the DM only ([scenes-map](specs/scenes-map.md)). | Ruler |
| **Trail** | In combat, the faint path of a token's moves this turn ([scenes-map](specs/scenes-map.md)). | Laser pointer |
| **Player-ready indicator** | Shows the DM which players have fully loaded a scene. Post-MVP ([scene-tools](specs/scene-tools.md)); MVP assumes immediate load. | — |
| **Encounter** | A planned set of monsters with CR/difficulty math. Lifecycle: planned → started → ended. The unit of combat history. | Combat; session |
| **Combat** | The running state of a started encounter: initiative order, rounds, turns. | Encounter |
| **Combatant** | A participant in a combat, linked to an entity (and a token if on a scene). Holds HP and temp HP (for PCs, both live on the character); effects target the combatant (monsters) or the character (PCs). | Token; Entity |
| **Companion** | A creature with an owner PC (and that PC's player): a pet or a summon; acts in a turn mode and gives its owner a companion card ([combat-tracker](specs/combat-tracker.md), [ADR-0056](architecture/adr/0056-companion-visibility.md)). | Ally |
| **Pet** | A companion that is its own copy of a creature definition, HP kept between fights, listed in the Party Manager's Party status tab; its owner may edit its stats ([entities](specs/entities.md)). | Summon |
| **Summon** | A companion placed from any monster for one fight; HP for that fight; Dismiss removes it and its token. | Pet |
| **Turn mode** | When a companion acts: right after its owner (default), in its owner's turn (no own Initiative row), or its own initiative. | Initiative |
| **Companion card** | The owner's window for a companion: HP, AC, speed, attacks with Roll, conditions. Not a character sheet ([character-sheet-full](specs/character-sheet-full.md)). | Character sheet |
| **Movement used** | Feet a combatant's token has moved since its turn started (5/10/5 per move, any mover); reset on Next. Indicator only. | Speed |
| **Turn alert** | The player client's alert (flash, ping, Toast) when one of its own PCs' turn starts. | Notification |
| **Initiative order** | Ordered list of combatants for the current combat: sorted by initiative, then the DM's tie order ([combat-tracker](specs/combat-tracker.md) FR-CBT-162). | — |
| **Tie order** | The DM's order inside a group of equal initiative, set by dragging a row; kept for the fight ([combat-extras](specs/combat-extras.md)). | Initiative |
| **Turn highlight** | The ring on the current turn's token, for everyone who may know whose turn it is ([scenes-map](specs/scenes-map.md)). | Target ring |
| **Party status** | The first tab of the Party Manager (was its own window until sprint 9), showing each PC's HP, temp HP and AC, companions under their owners; never monsters ([party-board](specs/party-board.md), [ADR-0063](architecture/adr/0063-party-hp-visibility.md)). | Party window |
| **Party Manager** | The party window (launcher "Party Manager"): tabs Party status, Handouts, Inventory, Loot, Reminders, Strongholds ([party-board](specs/party-board.md), #338). | Party status |
| **Reminder** | A note with optional clickable rolls aimed at the party or one character, with an optional source text; no mechanics ([reminders](specs/reminders.md)). | Condition, Effect |
| **Stronghold** | A party base (keep, ship) with staff, facilities, defenders, Stores and notes, opened in the Stronghold window; DM-only until shown ([strongholds](specs/strongholds.md)). | Scene |
| **Facility** | A room or building of a stronghold: planned / building / built / replaced, cost, build days, upkeep, income dice, effect, current order ([strongholds](specs/strongholds.md)). | — |
| **Staff** | A stronghold's hired people: name, role, wage, notes, optional facility they work in ([strongholds](specs/strongholds.md)). | Companion |
| **Defenders** | A stronghold's count of defenders ([strongholds](specs/strongholds.md)). | — |
| **Stores** | A stronghold's coin and items, a holder in the loot / inventory ledger next to the party pot and wallets ([ADR-0066](architecture/adr/0066-stores-holder.md)). | Party loot |
| **Session recap** | The on-demand summary of one session (fights, party tally, loot, notable rolls, awards), computed from the event log; the DM can Share it ([session-recap](specs/session-recap.md)). | Stats |
| **Rules window** | The quick-reference window of SRD rule cards on curated pages, with pins and house rules ([compendium](specs/compendium.md)). | Compendium |
| **Rule card** | One SRD rules section (a `rule` compendium entry), quoted verbatim ([compendium](specs/compendium.md)). | — |
| **House rule** | A DM-written `rule` entry shown on the Rules window's House rules page ([compendium](specs/compendium.md)). | Homebrew |
| **Macro** | A saved, named roll button ("Sneak Attack 3d6") that rolls through the normal roll path; on the sheet's Macros tab and the tray ([dice-extras](specs/dice-extras.md)). | Roll request |
| **Roll request** | The DM's request for a roll from chosen PCs (skill / save / check / custom; optional DC; results public or hidden) ([ADR-0061](architecture/adr/0061-roll-requests.md)). | Macro |
| **Prompt** | The pending card toast a roll request puts on each target's screen, with Roll and Decline. | Roll popup |
| **Pause screen** | The full-screen card players see while the DM pauses the table; input blocked, the DM keeps working ([play-shell](specs/play-shell.md)). | — |
| **Alert sound** | A DM-uploaded short audio file picked for an alert (turn, roll request, pause, resume); players' mute still wins ([assets-pipeline](specs/assets-pipeline.md)). | Alert |
| **Condition** | A 5e condition (e.g. prone, poisoned; exhaustion with a level), stored as an Effect on a combatant or character. No mechanics, except incapacitating ones end concentration. | Effect |
| **Effect** | A row on a creature in play: a condition, a custom label, or a concentration; optional duration in rounds ([combat-extras](specs/combat-extras.md)); custom effects may carry modifiers ([effect-modifiers](specs/effect-modifiers.md)). | Modifier |
| **Preset** | A named effect template with modifiers (built-in, customised per campaign, or a character's own), e.g. Bless, Rage; trigger presets (Sneak Attack …) create rule triggers ([effect-modifiers](specs/effect-modifiers.md)). | Effect; Dice style |
| **Map effect** | The animated look (`fx`) a spell row or an effect row can carry; drawn by each client from the effect's state, never sent as frames ([spell-fx](specs/spell-fx.md), ADR-0071). | Effect; Preset |
| **FX preset** | A named map-effect template with default parameters (Spirit Guardians, Shadow of Moil), picked on a spell row or an effect ([spell-fx](specs/spell-fx.md)). | Preset (effect template) |
| **Aura** | A map effect drawn around each token that is an active effect's target, for every viewer who receives that token ([spell-fx](specs/spell-fx.md)). | Template (AoE) |
| **Hit look** | The short animation on a target token for one applied damage type, healing, untyped damage or a glance ([spell-fx](specs/spell-fx.md)). | Hit cue |
| **Hit cue** | The transient server message after an applied damage or heal that tells clients to play a hit look; never stored, logged or in a snapshot; filtered per connection by token visibility ([spell-fx](specs/spell-fx.md), ADR-0071). | Damage card; Signal |
| **Glance** | The hit look for damage the target is immune to: a dull ring that stops short ([spell-fx](specs/spell-fx.md)). | Miss |
| **Map effects** (Preferences) | The per-browser level for map effects and hit looks: Full · Reduced · Still · Off ([spell-fx](specs/spell-fx.md) FR-VFX-25). | Reduced motion (OS) |
| **Rule trigger** | A data rule on a character or monster definition: event, requires, filters, frequency, effect (e.g. Sneak Attack once per turn); interpreted by built-in code, never user code ([ADR-0043](architecture/adr/0043-rule-triggers.md)). | Rule hook |
| **Damage part** | One typed term of an attack's damage: the base part or an extra part ([effect-modifiers](specs/effect-modifiers.md)). | Modifier part |
| **Offered part** | A rule-trigger damage part rolled with the damage and settled at apply; not in the card's total until it lands. | Modifier part |
| **Formula** | A rule trigger's value expression in MOD's small grammar (dice, numbers, `level(class)`, ability mods, proficiency); no code. | — |
| **Trigger window** | The turn / round / encounter key a charge belongs to. | — |
| **Charge** | One use of a rule trigger in its window, shown as Ready / Used this turn; Undo restores it. | Feature use |
| **Trigger state** | A derived display copy of a rule trigger's charge and in-effect state, per combatant; not the truth ([ADR-0049](architecture/adr/0049-trigger-state.md)). | Charge |
| **Overspend** | A feature use spent below zero, after the sender confirms ([effect-modifiers](specs/effect-modifiers.md)). | — |
| **Apply hook** | An append-only server registry entry that settles offered parts inside `cbt.applyCard`'s transaction. | Roll hook |
| **Mark** | A preset a `targetMarked` filter names (e.g. Hunter's Mark on the hunted creature). | — |
| **Toggle** | A character preset the owner or DM switches on / off, creating or ending its effect. | Preset |
| **Roll hook** | An append-only server registry entry that adds modifier parts to a roll inside the rolling command's transaction ([ADR-0038](architecture/adr/0038-effect-modifiers.md)). | Rule hook |
| **Concentration** | An Effect marking that a creature maintains a concentration spell (one per creature); damage raises a Concentration card. | — |
| **Concentration card** | A notification kind with a "Roll save" action (DC max(10, half the damage)) sent to the PC's owner or the DM. | Damage card |
| **Temp HP** | Temporary hit points on a character or combatant; absorb damage first, don't stack. | — |
| **Death save** | A PC's d20 roll at 0 HP; three successes = stable, three failures = dead (nat 1 = two failures, nat 20 = 1 HP). | — |
| **Rule hook** | A combat rule (expiry, concentration, death failures) run inside the causing command's transaction through `hpRules` / the `combatRuleHooks` registry ([ADR-0035](architecture/adr/0035-combat-rule-hooks.md)). Not a rule trigger. | Listener; Rule trigger |
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
| **Attack + damage** | *Retired (#385, [ADR-0073](architecture/adr/0073-tray-attacks.md)).* Was the sheet button that rolled to-hit and damage as one action. **Attack** and **Damage** now open the Dice tray pre-filled; in combat Attack makes a to-hit-only damage card that Damage completes ([ADR-0037](architecture/adr/0037-split-attack-damage.md)). | Damage card, Roll purpose |
| **HP formula** | Dice expression for a creature's hit points; Average = the stat block's HP max, Rolled = the formula rolled when the creature joins combat ([entities](specs/entities.md)). | — |
| **Action cue** | A few-second mark on a player's token on the DM's map when that player gets a pending action notification ([notifications](specs/notifications.md)). | Notification |
| **Attack popup** | The DM's non-modal panel to pick a damage card's targets (map selection or list), check hit vs AC per target, override values and apply. | Damage card |
| **Action owner** | Who may act on a pending notification (the DM or one player); the DM may always act. | Actor (a roll's actor in the game log) |
| **Combat log entry** | One applied HP change to one target in combat (damage or heal): the stats unit. Undo reverts one apply, which may hold several entries. | Game log entry; event log entry |
| **Stats window** | The launcher window with the live damage leaderboard (Fight) and session awards (Session), computed on request from saved facts, filtered per viewer ([stats](specs/stats.md), [ADR-0059](architecture/adr/0059-stats-read-models.md)). | Game log |
| **Session awards** | BG2-style records for one session (biggest hit, biggest overkill, most damage dealt / taken, most healing, kills, nat 20s / 1s, times downed); the DM's Show awards opens them for everyone. | Leaderboard (one fight) |
| **Overkill callout** | "— Overkill!" on a damage line (plus a toast) when damage beyond what was needed is ≥ max(10, what was needed); players never see the amount ([stats](specs/stats.md)). | — |
| **Kill feed** | A callout toast per kill or party down the viewer may see ("Thorn finished the Ogre"); live only ([stats](specs/stats.md)). | Game log |
| **Fight summary** | The Stats window opened on a fight at End, with its leaderboard and **Highlights** (MVP, biggest hit, kills, downs…). | Session awards |
| **Luck tracker** | The Stats Luck tab: rolls, d20s, average d20, nat 20s / 1s per character, per session or campaign, from public rolls. | — |
| **Trophy case** | A character's campaign-wide totals and records, on the sheet's Trophies tab (owner + DM). | Session awards |
| **Health band** | healthy / bloodied / down: what players see of a monster's HP instead of numbers. | — |
| **Log entry** | One game-log line; may join several rolls (e.g. an attack's to-hit and damage). | Roll; event log entry |
| **Roll mode** | normal / advantage / disadvantage, applied to the d20. | — |
| **Roll purpose** | Plain, attack or damage, set in the Dice tray before rolling (saved weapons and spells preset it): an attack's d20 decides the crit; a damage roll has a damage type per part. In combat a combatant's attack / damage roll feeds the damage card; the DM can **Use as attack / damage** a logged roll ([ADR-0073](architecture/adr/0073-tray-attacks.md)). | Dice tray, Damage card |
| **Physical-dice mode** | Per-browser toggle: every roll through the roll control asks for manual entry. | Manual roll |
| **Manual roll** | A roll entered from physical dice instead of rolled by the server. Logged and marked manual. | — |
| **Dice tray** | Window to compose, adjust or edit a roll before rolling it (sheet Attack / Damage open it pre-filled, [ADR-0073](architecture/adr/0073-tray-attacks.md)); staged rolls and clicked notation land here ([dice-extras](specs/dice-extras.md)). | Roll control |
| **Die group** | Dice of one size and one damage type in the Dice tray (e.g. 8d6 fire); an added die joins the last group of its size ([ADR-0073](architecture/adr/0073-tray-attacks.md)). | Dice tray, Roll purpose |
| **Throw** | The animation of one received `roll` entry (or all entries of one frame), on the dice layer, in the zone or in a popup, settling on the server's faces; cosmetic only ([ADR-0044](architecture/adr/0044-3d-dice.md), [ADR-0048](architecture/adr/0048-dice-display.md)). | Roll |
| **Dice layer** | The full-screen, topmost canvas the dice fly on; takes no input ([ADR-0048](architecture/adr/0048-dice-display.md)). | Canvas layer |
| **Roll popup** | The card in the toast region that shows a received roll with its dice ([ADR-0048](architecture/adr/0048-dice-display.md)). | Toast |
| **Die shape** | A die drawn flat as its outline with the value ([dice-extras](specs/dice-extras.md)). | — |
| **Dice look** | An owner's dice appearance (style, colours, material); everyone sees the roller's look. | — |
| **Preferences** | The window for a person's own settings (colour, sound, dice, layout, account), opened from the identity chip; each setting keeps its storage ([play-shell](specs/play-shell.md)). | Campaign settings |
| **Identity chip** | The top-right "● Name ⚙" button in both clients that opens Preferences and shows muted sound. | — |
| **Player colour** | A person's colour (`#rrggbb`), stored once and derived everywhere (pointer, templates, path, log names); must pass the validity and distance rules ([ADR-0055](architecture/adr/0055-player-colour.md), [ADR-0057](architecture/adr/0057-free-player-colour.md)). | Dice look |
| **Palette colour** | One of the 8 suggested player colours shown in the picker. | Player colour |
| **Dice style** | A named starting look (Ivory, Obsidian, …). | Preset (MOD) |
| **Notation link** | Dice notation in free text (e.g. "1d12 + 5") rendered clickable; stages a plain roll in the tray; its purpose can be changed there. | — |
| **Party loot** | Shared, party-visible log of the party's coin and rewards: loot the DM gives, party spending, coin moves between the party pot and wallets, and (sprint 3) party item moves and the DM's split. | Party board |
| **Party board** | Shared party window: handouts and the party inventory ([party-board](specs/party-board.md)). | Party loot |
| **Handout** | DM-authored title + text + up to 10 images, shared with everyone or chosen players. | Note |
| **Share / Unshare** | Making a handout visible to players or withdrawing it; "reveal" stays fog's word. Images a player already saw stay valid capabilities ([ADR-0023](architecture/adr/0023-asset-access-by-capability-id.md)). | Reveal (fog) |
| **Party inventory** | Items the party holds in common (`party-item` rows), outside any sheet. | Inventory (sheet) |
| **Item move** | Moving an item between the party inventory and a character's sheet items (or PC → PC) in one step, logged in party loot. | — |
| **Split** | The DM dividing the party pot's coin among the PCs: ⌊coin / n⌋ per denomination, remainder stays in the pot. | — |
| **Lazy record type** | A record type never sent in a snapshot; a client loads it on open with `sync.load` ([ADR-0045](architecture/adr/0045-lazy-record-types.md)). | Windowed record type |
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
| **Free area** | A part of the work area, right of the tool rail, that no open window covers; the map frames its tokens there (FR-SHELL-34, FR-MAP-44). *(Sprint 4)* Fit picks among the candidate free rectangles: PCs inside first, then the map's top row visible, then other tokens clear of windows, then the largest scale (FR-MAP-58). | Work area |
| **Auto placement** | Where a window opens when the user didn't choose: a free edge slot covering the fewest tokens, never on a window, a keep-out region or a PC while another window can be auto-minimised ([play-shell](specs/play-shell.md), #310). | Layout |
| **Useful size** | The smallest size a window opens at before the shell puts another window away to make room, checked by a content criterion per window ([play-shell](specs/play-shell.md) §7). | Minimum size |
| **Placer** | The one shell function that places every untouched window (remembered windows keep their spot, [ADR-0064](architecture/adr/0064-window-memory.md)) on every path (open, reopen, push, resize, refits): PCs clear first, then shrink to useful size, then put away the least recently used launcher window ([ADR-0060](architecture/adr/0060-one-window-placer.md)). | Auto placement |
| **Zone** | The default spot of a protected window (Game log, Initiative, sheet); used while it is clear of PCs, else the placer decides; taken on top of a remembered window ([ADR-0064](architecture/adr/0064-window-memory.md)). | Keep-out region |
| **Remembered window** | A window the user moved or resized: it reopens at exactly that size and spot (only nudged on-screen), the placer never moves, shrinks or puts it away; Reset layout forgets it ([ADR-0064](architecture/adr/0064-window-memory.md)). | Auto placement |
| **Theme** | A named look for the whole client (colour, type, frames), chosen per browser in Preferences: **Gilt & Stone** (the default, #355) or **Simple Dark** (the original shadcn look, formerly "Default"). Never changes layout or window sizes ([theme-system](specs/post-mvp/theme-system.md), [ADR-0069](architecture/adr/0069-theme-switch.md)). Avoid: skin, style. | Visual direction |
| **Medallion** | A round portrait: the image if there is one, else the initial on a colour; used in Game log rows, Initiative, Party status and Creatures ([kit-parity](specs/post-mvp/kit-parity.md)). | Token |
| **Result box** | A boxed roll total coloured by outcome (hit, miss, crit, damage, save), as in the kit's Game log ([kit-parity](specs/post-mvp/kit-parity.md)). | — |
| **Command palette** | The Ctrl+K overlay that searches commands, windows, characters, creatures (DM), rules and the compendium in one list ([play-shell](specs/play-shell.md), [ADR-0067](architecture/adr/0067-command-registry.md)). | Launcher |
| **Shortcuts sheet** | The `?` overlay listing every keyboard shortcut; single-key shortcuts can be switched off in Preferences ([play-shell](specs/play-shell.md)). | Command palette |
| **Alert** | The shell's attention signal for one client: screen flash, short UI sound ([ADR-0030](architecture/adr/0030-ui-notification-sounds.md)) and a Toast; per-browser mute and volume. Not persisted. | Notification |
| **Layout** | Every window's state, geometry and z-order for one (campaign, owner); stored only in browser `localStorage` (decisions #121). | — |

## System

| Term | Meaning |
|---|---|
| **Intent** | A client request to change state. Server validates, then mutates. |
| **Event** (WS event) | Server-to-client message carrying the filtered record changes (one or more records) of one domain event; produced after the visibility filter. |
| **Record change** | One record's change inside a domain event (before/after); sent to clients as `upsert` or `delete` after filtering. |
| **Visibility filter** | Server-side rule deciding which events/fields each client receives. |
| **MCP server** | The local stdio process (`bun run mcp`) that gives Claude Code DM tools over the running server; just another DM caller of the existing routes and intents, never the database ([ADR-0072](architecture/adr/0072-agent-mcp-server.md)). |
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
