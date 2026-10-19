# NNNN — Companions: the owner sees an owned creature's stats

- Status: proposed
- Date: 2026-10-19
- Amends: [ADR-0024](0024-definition-visibility.md) ("players never receive monster definitions"); refines [ADR-0036](0036-full-sheet-derivation.md) (other-player redaction whitelist) and [ADR-0021](0021-sync-protocol-conventions.md) (`combatant` visibility now reads the viewer, as `token` and `entity` already do)
- Affects: [entities](../../specs/entities.md), [combat-tracker](../../specs/combat-tracker.md), [character-sheet-full](../../specs/character-sheet-full.md), [party-board](../../specs/party-board.md), [scenes-map](../../specs/scenes-map.md); data model, protocol
- Raised by: BL-30 (DM [#252](../../decisions-log.md)), sprint 6 track CP; OQ-CBT-80

## Context

- DM #252 / BL-30: a creature can have an **owner player** (pet owlbear, Drakewarden drake, summoned fire elemental). The owner gets a **companion card** built from the stat block (HP, AC, speed, attacks with Roll, conditions) and attacks with it like with a PC.
- ADR-0024: players never receive monster definitions; instances carry only name, image, size, creature type. ADR-0036: other players get a character redacted to one whitelist.
- Visibility fns read only the record and the connection context (ADR-0021). A summon points at a **shared** definition (SRD Fire Elemental, a prepared custom): making that definition visible to the owner would leak it to them everywhere, also for unowned instances.
- A **pet** is the player's own copy of a definition (DM #252: "its own copy"), so nothing prepared leaks through it.
- Measured (CON-44, heavy harness, throwaway probe): see Consequences.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Pet entity full to its owner; owned combatants carry a `card` display copy sent to the owner only; others get band + ownership** | Filters stay pure (owner id on the record); a shared definition never reaches a player; one card shape for pet and summon | One more copy to refresh (combatant `card`, in the definition-changed hook as `hpMax` today); `combatant` visibility needs the viewer |
| B. Definitions visible to a player while they own an instance of it | No copy | Breaks ADR-0021 (a fn would read other records) or needs a ref-counted flag on the definition (ADR-0024 option D's flaw: one owned summon leaks the SRD row for every other instance) |
| C. Every summon creates a per-owner custom copy (summons become short-lived pets) | One path (entity full to owner) | No delete for entities (FR-ENT-14): copies pile up per fight; names collide (FR-ENT-08); the Creatures window fills with "Fire Elemental (Mira) 7" |
| D. No player stats: the owner sees name + band; the DM rolls every companion attack | Nothing to change | Fails #252 (card, Roll, attacks via the popup like any player) |

## Decision

> Undecided. **A** proposed.

- **Pets** (`entity` kind `monster` with `companionOf` set): DM full; **owner** (`ownerPlayerId = ctx.playerId`) **full**; other players redacted to `{id, kind, name, portraitAssetId, ownerPlayerId, companionOf, band}` (`band` derived from `hpCurrent` / `statBlock.hpMax` in the fn, FR-CBT-26's rule). Every other monster stays hidden (ADR-0024 unchanged for them).
- **Companion combatants** (`ownerPlayerId` set): DM full; **owner** gets the monster redaction plus `hpCurrent`, `hpMax`, `tempHp`, `ownerCharacterId`, `ownerPlayerId`, `turnMode`, `pet` and **`card`** (stat-block subset: size, type, AC, HP max, speed, ≤ 8 attack rows; written at join and by the definition-changed hook, never per-instance editable); other players get the monster redaction (band) plus `ownerCharacterId`, `ownerPlayerId`, `turnMode`. `concentrationEffectId` stays DM-only. Hidden or inactive → hidden for everyone, owner included (as a hidden PC, #141).
- The `combatant` visibility fn takes the viewer (`(r, v)`), like `entity` and `token`; it still reads only the record and the connection context.
- Other players' redaction lists (ADR-0036's table) gain one row: **pet** `{id, kind, name, portraitAssetId, ownerPlayerId, companionOf, band}`. Characters' whitelist is unchanged.

## Consequences

- ADR-0024's first bullet reads: "Players never receive monster definitions, **except a pet's own copy, full to its owner** (this ADR)". Token copies unchanged (no stat field on tokens; speed stays owner-only as built).
- Players learn their own companion's numbers (AC, HP, attacks) — the point of #252. A summon's card reveals that definition's numbers to its owner only, while it is theirs; release / turn hostile / dismiss sends the owner an upsert without them (or a delete).
- New leak strings for every leak scan: a non-owner frame never carries `card`, `hpCurrent` / `hpMax` of a companion combatant, a pet's `statBlock` or `hpCurrent`, or `concentrationEffectId`.
- CON-44 (measured, heavy harness: base DM 681,860 B, players ≤ 286,615 B): worst 6 players × 4 owned combatants with 8-attack cards + 3 pets each: **DM +106,026 B → 787,886 B** (of 1.5 MiB), **players +25,337 B → ≤ 311,952 B** (of 512 KiB). Card 2,038 B at 8 max attacks; pet row 2,896 B full, 285 B redacted.
- Build: CP's core slice changes the `combatant` and `entity` visibility fns and their tests (leak scans per player).
