# Proposed — Rule triggers: conditional, event-driven modifiers (class features like Divine Fury)

- Status: proposed. **Need decided by the DM (decision #203, 2026-10-16)**; the sprint-3 effect-modifiers spec agent writes Options / Decision; the integrator numbers it when the DM accepts it at sprint-3 gate 1
- Date: 2026-10-16
- Refines: [ADR-0038](0038-effect-modifiers.md) (effect modifiers: static roll-time riders via `rollHooks`), [ADR-0035](0035-combat-rule-hooks.md) (combat rule hooks in the causing command's transaction), [ADR-0016](0016-domain-events-pending-actions.md) (domain events)
- Not a plugin system ([ADR-0007](0007-product-scope.md) Out "extension / plugin system"): triggers are data interpreted by built-in code, not user code
- Affects: [effect-modifiers](../../specs/effect-modifiers.md), [combat-tracker](../../specs/combat-tracker.md), [combat-extras](../../specs/combat-extras.md), [character-sheet-full](../../specs/character-sheet-full.md), [dice-roll-log](../../specs/dice-roll-log.md)

## Context

- MOD tier 1 applies static parts (bonus dice, flat bonuses) to every matching roll while an effect is active.
- The DM's table needs conditional riders. Reference case (#203), **Zealot barbarian, Divine Fury**: while raging, the first creature hit on each of the barbarian's turns with a weapon attack takes **+1d6 + half the barbarian level** radiant (or necrotic) damage. "There are going to be a lot of customisations like this", so the model must be general.

## What a trigger needs (from the reference case)

| Part | Divine Fury |
|---|---|
| Owner / source | A character feature or preset on the character (toggled with Rage) |
| Requires | An active effect (Rage) |
| Event | An attack that **hits** (the hit is decided at apply by the DM, #134 / #136; or at the card) |
| Filter | Weapon attack; the attacker is the owner |
| Frequency | **Once per turn** (first hit on each of the owner's turns); resets on the owner's turn start |
| Effect | Add a damage part `1d6 + floor(classLevel(barbarian) / 2)` of type radiant / necrotic |
| Formula vars | Class level, total level, ability modifiers, proficiency bonus |
| Visibility / undo | Like other modifier parts (#190 rules); undo restores the once-per-turn charge |

## Open for the spec agent (options + pick for gate 1)

- Where triggers run: on domain events after commit (listener) vs inside the causing command's transaction (rule-hook style, ADR-0035; crash-safe, undoable) vs at roll time (rollHooks) with "on hit" decided later at apply.
- Trigger record shape (event, filters, requires, frequency, effect, formula) and a small expression language for formulas (no arbitrary code).
- Per-turn / per-round / per-rest counters and their reset points; interaction with undo and Prev.
- Presets for common class features (Divine Fury, Sneak Attack once per turn, Hunter's Mark on the marked target, Colossus Slayer…), hand-editable.
- How the DM sees and overrides an applied trigger part on the card / popup.
