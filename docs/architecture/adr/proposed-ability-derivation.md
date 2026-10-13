# proposed — Ability modifiers, proficiency bonus and save bonuses derived in MVP

- Status: proposed (spec-feedback, 2026-10-13); number assigned by the integrator
- Amends: [ADR-0012](0012-character-derived-values.md) (MVP basics: stored, "no derivation code")
- Affects: [entities](../../specs/entities.md) (FR-ENT-23/24), [character-sheet](../../specs/character-sheet.md) (FR-CHAR-19–23), [combat-tracker](../../specs/combat-tracker.md) (FR-CBT-44)
- Raised by: decision #149 (F9: players type checks and saves because the sheet has no buttons); OQ-CHAR-16, OQ-CHAR-17

## Context

- #149: the sheet gets click-to-roll for the 6 ability checks and 6 saves in MVP; ability scores and save proficiencies are **stored**.
- A roll needs a bonus. A check uses the ability modifier; a save adds the proficiency bonus when proficient.
- ADR-0012 keeps MVP basics as plain stored numbers and says "MVP: no derivation code". The full-sheet choice (A–D) is still open.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Store scores + save proficiencies; derive modifier, proficiency bonus (level / CR) and check / save bonuses with fixed 5e formulas in `@shared/entities`** | Matches #149; sheet shows real scores; no stale bonuses on level-up; formulas are rule-fixed, not homebrew | First derivation code in MVP |
| B. Store all 12 bonuses (+ scores for display) | No derivation | 18 numbers to keep consistent; fixtures and the creature form grow |
| C. Store modifiers only | No derivation | No scores shown; full sheet re-enters data |

## Decision (proposed)

**A.** Pure functions in `@shared/entities`: `abilityMod(score) = floor((score − 10) / 2)`; `proficiencyBonus(def)` = 2 + floor((level − 1) / 4) for characters, the SRD CR table for monsters; `checkBonus`, `saveBonus`. Never stored. Initiative bonus, AC, HP and the attack stay stored as in ADR-0012.

## Consequences

- ADR-0012 "MVP basics: stored" gains: "ability modifiers, proficiency bonus and check / save bonuses are derived (fixed formulas, #149)"; "no derivation code" is limited to the basics.
- If the full sheet picks C or D, these functions become the default the overrides sit on; nothing stored has to change.
- Server and clients share the functions, so the button label and the server's roll always agree.
