# Proposed — Cross-reference decision (folds into ADR-0011)

- Status: proposed, for the DM's gate on [linked-notes](../../specs/linked-notes.md). The integrator folds it into [ADR-0011](0011-cross-references.md) at acceptance.
- Date: 2026-10-31
- Answers: ADR-0011's model and its four questions. Mirrors OQ-NOTES-01–05.
- Affects: [linked-notes](../../specs/linked-notes.md), [world-builder](../../specs/post-mvp/world-builder.md), [obsidian-importer](../../specs/post-mvp/obsidian-importer.md), [agent-api](../../specs/agent-api.md), [compendium](../../specs/compendium.md), [entities](../../specs/entities.md)
- Constraints: [ADR-0021](0021-sync-protocol-conventions.md) (visibility reads record + context only), [ADR-0024](0024-definition-visibility.md) (players never receive monster definitions), [ADR-0045](0045-lazy-record-types.md).

**Nothing below is decided until the DM picks.** Bold = suggested.

## 1. Model (OQ-NOTES-01)

| Option | Pros | Cons |
|---|---|---|
| A. Explicit relations table | Queryable, typed | No links inside prose; rigid while writing |
| B. Inline references only | Natural writing | Backlinks need an index anyway; untyped |
| **C. Both: inline links indexed as untyped mentions (`note_link`); typed relations added later as a nullable `relType`** | One query surface; backlinks trivial; graph possible later | Index kept in step (one transaction with the save); **only the mention half is built now** |

## 2. Link target (OQ-NOTES-02)

| Option | Pros | Cons |
|---|---|---|
| **Stable ID; display = target's current title, or the writer's alias** | Renames never break a link; no copy to refresh or leak | Stored text isn't human-readable, so the editor maps titles ⇄ IDs |
| By title (Obsidian) | Readable storage | Rename breaks links, or rewrites every note |
| ID + stored display copy | Readable render without a lookup | A copy to refresh, and it can carry a hidden title |

## 3. Target deleted (OQ-NOTES-03)

| Option | Pros | Cons |
|---|---|---|
| **Dangling: link row stays with its last title; the DM sees it struck through with Remove; players see what hidden shows** | Nothing else edited; deleted and hidden look the same to players | Dead links to tidy (the list marks them) |
| Rewrite sources to plain text | No dead links | Edits notes the DM didn't touch; irreversible |
| Tombstone, restorable | Undo for deletes | A trash feature to build |
| Block while linked | No dead links | Annoying mid-prep |

## 4. What a player sees when a note they can read mentions something hidden (OQ-NOTES-04)

The DM writes: `Ask [[Duke Varen]] about [[Duke Varen|the old sailor]]. Beware [[creature:Elite Goblin]]. See [[Burnt Ledger]].`
Player 1 may see Duke Varen; Player 2 may not. Burnt Ledger was deleted. Elite Goblin is a creature.

| Reader | **B. Alias as plain words, else `(unknown)`** | A. Always `(unknown)` | C. Drop it |
|---|---|---|---|
| Player 1 | Ask <u>Duke Varen</u> about <u>the old sailor</u>. Beware (unknown). See (unknown). | Same | Ask <u>Duke Varen</u> about <u>the old sailor</u>. Beware . See . |
| Player 2 | Ask (unknown) about the old sailor. Beware (unknown). See (unknown). | Ask (unknown) about (unknown). Beware (unknown). See (unknown). | Ask  about . Beware . See . |

| Target for Player 2 | B | A | C |
|---|---|---|---|
| Hidden note | `(unknown)` or alias | `(unknown)` | Nothing |
| Hidden creature | Same | Same | Same |
| Deleted note | Same, indistinguishable | Same | Same |

| Option | Pros | Cons |
|---|---|---|
| **B** | Reads well; an aliased mention leaves no trace, on screen or in the frame | A careless alias gives away what it says; the Reveal dialog lists them all first |
| A | Tightest: only DM-typed plain prose ever shows | Prose stutters; aliases do nothing for players |
| C | No sign anything is hidden | Broken sentences |

**Mechanism, any option:** the player-visible text is compiled once at save and never depends on another note's state. A link reaches a player as a span over that text only if they may see its target. No span = no ID, no title, no marker. So the frame holds no more than the screen.

## 5. Other link targets (OQ-NOTES-05)

| Option | Pros | Cons |
|---|---|---|
| **Yes: compendium entries, characters and creatures by ID, shown only if the reader may read the target** (compendium: `entryVisibleTo`; character: name, per ADR-0024; creature: never to players) | "See Fireball" just works; no copies | Each kind's rule to keep and test |
| Notes only for now | Smallest | The DM's most common outside link is missing |
| Compendium through a campaign clone only | One target kind | Needless copies of read-only entries |

## Consequences (if the picks hold)

- Table `note_link` (one row per link, server-only, part + kind + target), rebuilt in the save's transaction.
- A later link kind adds a `targetKind` and a rule; quests, pins and importers plug into the same query.
- Glossary **Cross-reference** gets its model link; adds Wikilink, Backlink, Mention, Alias (OQ-NOTES-13).
- Obsidian import stays thin: `[[Title]]` input and unresolved links are the format.
