# 0012 — Character sheet: derived vs stored values, homebrew overrides

- Status: accepted for MVP basics (2026-10-11): **stored**. Full-sheet derivation still open.
- Date: 2026-10-10
- Amended by: [ADR-0032](0032-ability-derivation.md) (ability modifiers, proficiency bonus and check / save bonuses derived, #154)
- Affects: character-sheet, combat-tracker, dice-roll-log, post-mvp/character-sheet-full, post-mvp/levelling
- MVP: blocking only for the basics (AC, HP, initiative, one weapon attack) per [ADR-0014](0014-mvp-scope.md). Choice must not block the full sheet later.

## Context

- Full 5e sheet from day one ([ADR-0007](0007-product-scope.md)).
- Many values are derivable (modifiers, proficiency bonus, save/skill bonuses, spell DC, passive perception, AC from armour).
- Tables often homebrew rules; players need manual overrides.
- Click-to-roll needs a reliable bonus for each roll.

## Options

| Option | Pros | Cons |
|---|---|---|
| A. **All stored**: player types every number | Trivial; any homebrew works | Error-prone; no automation; levelling is manual |
| B. **All derived**: compute from base data + rules | Always consistent | Every homebrew rule needs code; brittle |
| C. **Derived with overrides**: compute by default; any derived field can be overridden (with optional reason) | Automation + escape hatch | Must show "overridden" state; overrides can go stale |
| D. **Derived + modifier list**: compute from base + list of named modifiers (`+1 AC, Ring of Protection`) | Transparent; models items/feats/homebrew | More data model; needs a modifier vocabulary |

## Decision

- **MVP basics: stored (option A, decided 2026-10-11).** AC, max/current HP, initiative bonus, and one weapon attack (attack bonus, damage dice + bonus) are plain stored numbers on the character, set by fixtures.
- **Full sheet: undecided.** Choose among A–D when [character-sheet-full](../../specs/post-mvp/character-sheet-full.md) is specced. If C or D is chosen, the MVP stored values become overrides/base values; MVP must not assume they can never be derived.

## Questions to answer

- Where is derivation computed: server, client, or shared module? (server authority per [ADR-0005](0005-server-authoritative-sync.md))
- Are derived values persisted (for crash safety / agent access) or recomputed?
- How do monster stat blocks (combatants) relate — same derivation?

## Consequences

- MVP: no derivation code; [character-sheet](../../specs/character-sheet.md) stores the basics and validates them with zod.
- Full-sheet consequences: fill once the full-sheet option is decided.
