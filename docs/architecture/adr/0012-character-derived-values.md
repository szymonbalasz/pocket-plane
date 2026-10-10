# 0012 — Character sheet: derived vs stored values, homebrew overrides

- Status: proposed
- Date: 2026-10-10
- Affects: character-sheet, combat-tracker, dice-roll-log, post-mvp/levelling

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

> Undecided.

## Questions to answer

- Where is derivation computed: server, client, or shared module? (server authority per [ADR-0005](0005-server-authoritative-sync.md))
- Are derived values persisted (for crash safety / agent access) or recomputed?
- How do monster stat blocks (combatants) relate — same derivation?

## Consequences

> TODO (spec phase): fill once decided.
