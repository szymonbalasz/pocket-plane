# proposed — Full character sheet: derived with overrides; rules data vs sheet record

- Status: proposed (spec-character-sheet-full, sprint 1 track S)
- Date: 2026-10-14
- Decides: [ADR-0012](0012-character-derived-values.md) "Full sheet: undecided"; extends [ADR-0032](0032-ability-derivation.md)
- Refines: [ADR-0021](0021-sync-protocol-conventions.md) D (transport) and [ADR-0024](0024-definition-visibility.md) (redacted character fields); see the last two Decision bullets
- Affects: [character-sheet-full](../../specs/character-sheet-full.md), [character-sheet](../../specs/character-sheet.md), [entities](../../specs/entities.md), [combat-tracker](../../specs/combat-tracker.md), [combat-extras](../../specs/combat-extras.md), [levelling](../../specs/post-mvp/levelling.md), [data model](../../data-model/README.md)
- Raised by: OQ-CHARX-01, OQ-CHARX-02

## Context

- Players fill in their own sheets by hand (#177): no class, species or item data until the compendium and levelling.
- ADR-0032 already derives modifiers, proficiency bonus, checks and saves with fixed 5e formulas; ADR-0012 left the full sheet open (options A–D).
- Many more numbers are derivable from scores + level + proficiencies: skills, passives, spell attack, spell save DC, hit dice. Tables homebrew (Jack of All Trades, Bracers, Alert).
- A character's `entity` row is upserted on every HP change (combat damage, sheet heal). Long text, inventory and spells on that row would resend 10–48 KB per HP change.

## Options

**A. Derivation**

| Option | Pros | Cons |
|---|---|---|
| A. All stored | Any homebrew; no code | ~40 numbers to keep in sync by hand; stale after every score change |
| B. All derived | Always consistent | Every homebrew rule needs code |
| **C. Derived with overrides (fixed key list)** | Automation + escape hatch; ADR-0032 functions become the defaults | Overrides can go stale (level-up); UI must show "overridden" |
| D. Derived + modifier list | Transparent, models items / feats | Needs a modifier vocabulary and item data we don't have |

**B. Storage**

| Option | Pros | Cons |
|---|---|---|
| **1. Rules numbers in `entity.statBlock`; text, spells, inventory, counters, draft / lock in a new `creature-sheet` record** | HP upserts stay ~2–4 KB; combat and helpers read one place for numbers; separate visibility (owner + DM) | One more record type; owner copied onto the sheet row |
| 2. Everything in `statBlock` | No new table | Every HP change resends the whole sheet; notes in the creature core |
| 3. Everything in a new table | Entities untouched | Combat and helpers read numbers from two places |

## Decision (proposed)

- **C + 1.**
- **Derived** (pure, `@shared/entities`, both kinds, never stored): ability mod, proficiency bonus, check, save, skill (none / proficient / expertise), passive Perception / Investigation / Insight, spell attack, spell save DC, hit dice per die size.
- **Stored base**: scores, levels / classes, proficiencies, AC, HP max, initiative bonus (#154), speed, attack to-hit and damage, slot maxima.
- **Overrides**: `statBlock.overrides[key] = {value, note?}` for `proficiency`, `check.*`, `save.*`, `skill.*`, `passive.*`, `spellAttack`, `spellDc`. An override replaces the derived value everywhere (labels, server rolls, combat); `proficiency` feeds the others. Helpers keep their signatures, so callers get overrides for free.
- **Computed** in the shared module on server and clients (server authority for rolls, ADR-0005); never persisted. Monsters use the same functions (ADR-0012's third question), so ADR-0032's known deviation for SRD monster saves can be fixed by an override on a custom definition.
- **Refines ADR-0021 D:** sheet edits go over WS (`char.edit`, row and counter intents) for both roles and for **both characters and NPC sheets** (custom definitions). They give one per-field-merge path; a player's edits in play are live play anyway. Entities' `PUT /api/entities` stays for the creature form (whole replace). Both write in commit order: per-field last write wins vs whole-block last write wins. `PUT` never touches `creature-sheet`. (OQ-CHARX-14)
- **Refines ADR-0024:** other players receive a character redacted to **one whitelist**, kept in entities' visibility fn (ENT-owned; every spec adding a key amends this list):

| Key | Source |
|---|---|
| `id`, `kind`, `name`, `portraitAssetId`, `ownerPlayerId` | ADR-0024 (#120) |
| `down` | #154, FR-ENT-15 |
| `level`, `className`, `species` | FR-CHARX-35 (OQ-CHARX-05) |
| `deathState` | combat-extras (OQ-CBTX-09) |

  No HP, AC, scores, counters or text. OQ-CHARX-05 and OQ-CBTX-09 go to the DM together.

## Consequences

- ADR-0012 gains: "Full sheet: C (derived with overrides), see this ADR." MVP stored basics stay stored; nothing stored has to change.
- Entities' creature core gains optional `skills`, `overrides`, `spellcasting` (+ character `classes`, `species`); `attacks` grows to 0–20. Zod only, no column, no backfill.
- New table and record type `creature-sheet` (campaign scope; DM full, owning player full, others hidden). Owner changes write both rows in one transaction.
- Levelling later writes the same base fields; stale overrides are its problem to surface (e.g. "3 overrides — review").
- A modifier list (option D) can still come with the compendium: modifiers would feed the derived value before an override applies.
