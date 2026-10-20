# NNNN — Companions: the owner sees an owned creature's stats

- Status: accepted (DM gate 1, #288: A; with CP-3 → B, the owner also edits a pet's AC, HP max, speed and attack rows on its card, FR-ENT-38: visibility unchanged). The integrator numbers it
- Date: 2026-10-19 (review pass 2026-10-20)
- Amends: [ADR-0024](0024-definition-visibility.md) ("players never receive monster definitions"); refines [ADR-0036](0036-full-sheet-derivation.md) (other-player redaction lists) and [ADR-0009](0009-entity-content-model.md) (a pet is a definition with play state, `hpCurrent`, like a character). The `combatant` redaction uses the viewer, as `entity` and `token` already do (ADR-0021 unchanged)
- Affects: [entities](../../specs/entities.md), [combat-tracker](../../specs/combat-tracker.md), [character-sheet-full](../../specs/character-sheet-full.md), [party-board](../../specs/party-board.md), [scenes-map](../../specs/scenes-map.md), [dice-roll-log](../../specs/dice-roll-log.md) (one entry field); data model, protocol
- Raised by: BL-30 (DM [#252](../../decisions-log.md)), sprint 6 track CP; OQ-CBT-80; review-a #1, #12, #18

## Context

- DM #252 / BL-30: a creature can have an **owner player** (pet owlbear, Drakewarden drake, summoned fire elemental). The owner gets a **companion card** built from the stat block (HP, AC, speed, attacks with Roll, conditions) and attacks with it like with a PC.
- ADR-0024: players never receive monster definitions; instances carry only name, image, size, creature type. ADR-0036: other players get a character redacted to one whitelist.
- Visibility fns read only the record and the connection context (ADR-0021). A summon points at a **shared** definition (SRD Fire Elemental, a prepared custom): making that definition visible to the owner would leak it to them everywhere, also for unowned instances.
- A **pet** is the player's own copy of a definition (DM #252: "its own copy"), so nothing prepared leaks through its stats to the owner. To other players, however, the pet row itself would announce a prepared pet (ADR-0024 option B's prep leak), and a player's public roll lines would show the companion's bonuses and dice.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Pet entity full to its owner (minus `derivedFromId`), to others only while present; owned combatants carry a `card` copy sent to the owner only; companion roll lines DM + owner; others get band + ownership + outcome lines** | Filters stay pure (owner id, presence flag on the record); a shared definition never reaches a player; a prepared pet stays secret; one card shape for pet and summon | Two server-written flags to keep in step (`petPresent`, `ownerHidden`) and one copy (`card`) to refresh; one new `game-log-entry` field (`audiencePlayerId`) |
| B. Definitions visible to a player while they own an instance of it | No copy | Breaks ADR-0021 (a fn would read other records) or needs a ref-counted flag on the definition (ADR-0024 option D's flaw: one owned summon leaks the SRD row for every other instance) |
| C. Every summon creates a per-owner custom copy (summons become short-lived pets) | One path (entity full to owner) | No delete for entities (FR-ENT-14): copies pile up per fight; names collide (FR-ENT-08); the Creatures window fills with "Fire Elemental (Mira) 7" |
| D. No player stats: the owner sees name + band; the DM rolls every companion attack | Nothing to change | Fails #252 (card, Roll, attacks via the popup like any player) |

## Decision

> **A** (DM, #288).

- **Pets** (`entity` kind `monster` with `companionOf` set): DM full; **owner** (`ownerPlayerId = ctx.playerId`) full **minus `derivedFromId`** (it may name a prepared custom) and the DM-only `petPresent`; **other players only while `petPresent`** (the pet has an active companion combatant, or an unhidden token on the active scene; server-written in the transaction of every command that changes either), redacted to `{id, kind, name, portraitAssetId, ownerPlayerId, companionOf, band}` (`band` derived from `hpCurrent` / `statBlock.hpMax`, FR-CBT-26's rule); otherwise hidden. Every other monster stays hidden (ADR-0024 unchanged for them).
- **Companion combatants** (`ownerPlayerId` set): DM full; **owner** gets the monster redaction plus `hpCurrent`, `hpMax`, `tempHp`, `ownerCharacterId`, `ownerPlayerId`, `turnMode`, `pet` and **`card`** (stat-block subset: size, type, AC, HP max, speed, ≤ 8 attack rows with stable ids; written at join and by the definition-changed hook, never per-instance editable); other players get the monster redaction (band) plus `ownerCharacterId`, `ownerPlayerId`, `turnMode`. `concentrationEffectId` and `ownerHidden` stay DM-only. Hidden, inactive, or **of a hidden owner** (`ownerHidden`, #141) → hidden for every player, the owner included.
- **Roll lines:** a companion's attack / damage roll entries (in combat) and a pet's out-of-combat rolls are `public: false` with **`audiencePlayerId` = the owner**: the DM and the owner see them; other players don't. The public **outcome line** is built as for a monster attacker, with the to-hit total, natural flag, hit / miss and damage totals and types in `payload`, and the "N + M" split, the bonus and every die in `dmPayload`.
- Other players' redaction lists (ADR-0036's table) gain one row: **pet (while present)** `{id, kind, name, portraitAssetId, ownerPlayerId, companionOf, band}`. Characters' whitelist is unchanged.

## Consequences

- ADR-0024's first bullet reads: "Players never receive monster definitions, **except a pet: full to its owner (minus `derivedFromId`), redacted to others while it is present** (this ADR)". Token copies unchanged (no stat field on tokens; speed stays owner-only as built).
- **Leak surface, stated** (review-a #1):
  - (a) **Roll lines:** closed. Other players never see a companion's to-hit bonus, damage dice or per-die values; they see outcome totals and the band. The owner sees their own companion's dice.
  - (b) **Pet rows to non-owners:** a pet's name, portrait, owner and band reach other players only while it is present at the table (fight or visible token on the shown scene); a prepared pet stays secret until then. Accepted once present: its existence, owner and band.
  - (c) **`derivedFromId`:** stripped from the owner's view.
  - Accepted (all options): other players see who owns a companion and its turn mode; the owner learns a summoned definition's AC, HP and attacks while it is theirs (#252); release / turn hostile / dismiss sends the owner an upsert without them, or a delete.
- **Timing tell** (review-a #18): clearing a summon's DM-only `concentrationEffectId` changes no field a player receives, so the hub drops that player upsert as an identical change (FR-SYNC-17 / -19, `deliver`'s per-change drop); the frame players get is the effect event they already receive. No new tell; tested (`FR-CBT-120`).
- **Leak strings** for every leak scan: a non-owner frame never carries `card`, `hpCurrent` / `hpMax` / `tempHp` of a companion combatant, a pet's `statBlock`, `hpCurrent` or `turnMode`, a companion's roll line (its id, its bonus, its dice) or the outcome line's "N + M" split, a **prepared pet's name** (not present), `concentrationEffectId`, `ownerHidden`; the owner's frames never carry `derivedFromId` on a pet.
- New fields: `entity.pet_present`, `combatant.owner_hidden` (DM-only flags), `game_log_entry.audience_player_id` (dice-roll-log: one nullable column and one visibility branch, "a non-public entry reaches the player it names").
- CON-44 (measured, review pass, on `snapshot-size.test.ts`'s committed worst rows): DM 650,704 → **757,344 B** (+106,640) with CP's worst (24 owned combatants with 8-attack cards, 18 present pets), players ≤ **290,285 B** (+24,508); with IM's worst tags (+112.5 KB DM, summed) ≈ 869,800 B DM of 1.5 MiB, players ≤ 290,285 B of 512 KiB.
- Build: CP's core slice changes the `combatant`, `entity` and `game-log-entry` visibility fns and their tests (leak scans per player).
