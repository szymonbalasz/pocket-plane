# Proposed — Rule triggers: conditional, event-driven modifiers (class features like Divine Fury)

- Status: **proposed**. Need decided by the DM (decision #203, 2026-10-16). Options and **picks** below are the sprint-3 effect-modifiers spec's suggestions for gate 1, **not decided**; the integrator numbers this ADR when the DM accepts it
- Date: 2026-10-16
- Refines: [ADR-0038](0038-effect-modifiers.md) (effect modifiers: static roll-time riders via `rollHooks`), [ADR-0035](0035-combat-rule-hooks.md) (combat rule hooks in the causing command's transaction), [ADR-0016](0016-domain-events-pending-actions.md) (domain events), [ADR-0037](0037-split-attack-damage.md) (a card's damage may be rolled after its to-hit)
- Not a plugin system ([ADR-0007](0007-product-scope.md) Out "extension / plugin system"): triggers are data interpreted by built-in code, not user code
- Affects: [effect-modifiers](../../specs/effect-modifiers.md) (FR-MOD-32–52), [combat-tracker](../../specs/combat-tracker.md), [combat-extras](../../specs/combat-extras.md), [character-sheet-full](../../specs/character-sheet-full.md), [dice-roll-log](../../specs/dice-roll-log.md), [live-sync](../../specs/live-sync.md) (lazy type), dice-extras, compendium, [notifications](../../specs/notifications.md), [AGENTS §9.9](../../../AGENTS.md#99-shared-files)

## Context

- MOD tier 1 applies static parts (bonus dice, flat bonuses) to every matching roll while an effect is active.
- The DM's table needs conditional riders. Reference case (#203), **Zealot barbarian, Divine Fury**: while raging, the first creature hit on each of the barbarian's turns with a weapon attack takes **+1d6 + half the barbarian level** radiant (or necrotic) damage. "There are going to be a lot of customisations like this", so the model must be general.
- A hit is only known when the DM applies a card (#134, #136); the damage is rolled earlier, at the card (ADR-0037). Cards are notifications: player-safe payload, no DM-only part.
- CON-44: the heavy DM snapshot has ~8 KB above the 100 KiB headroom guard (measured, MOD §12).
- Seams pass (orchestrator, 2026-10-16): on-demand data uses one generic path, the [proposed lazy-record-types ADR](proposed-lazy-record-types.md) (S1); this ADR adds no load path of its own.

## What a trigger needs (from the reference case)

| Part | Divine Fury | Model (MOD §8.4) |
|---|---|---|
| Owner / source | A feature of the character | `rule-trigger` row on a character or a monster definition |
| Requires | An active effect (Rage) | `requires.preset` = the effect's `presetKey` |
| Event | An attack that **hits** | `on: hit` (also `roll`, `turnStart`) |
| Filter | Weapon attack, on the owner's turn | `when: [via weapon, ownTurn]` (+ crit, mode, target marked / hurt, `ask`) |
| Frequency | Once per turn | `every: turn` (each / round / encounter / a feature's uses) |
| Effect | Damage part `1d6 + floor(level(barbarian) / 2)` radiant | `then: {do: damage, formula, type}` (+ roll part, mode, reminder) |
| Visibility / undo | As modifier parts; undo restores the charge | per-trigger `public`; window keys + use rows |

## Decision 1 — Where triggers run

| Option | Pros | Cons |
|---|---|---|
| A. Everything at apply: `cbt.applyCard` rolls the extra dice for each hit target | Hit known exactly; one place | The player never rolls those dice (physical dice, 3D tray); the popup can't show the number before apply; crit handled twice |
| **B. Offered at the damage roll, settled at apply (pick)**: MOD's roll hook rolls a passing `hit` trigger with the card's damage and records it as an **offered** part (card + server-only use row); `cbt.applyCard` runs a new append-only **`applyHooks`** registry per target that lands each ticked part on one hit target and spends the charge; `cbt.undo` runs the hook's `revert` | Both steps in the causing command's transaction (ADR-0035): crash-safe, undoable; the player rolls with their damage; the DM sees the number and overrides it; crit doubling comes free | A card can show a part that never lands (miss, charge used by another card first → `conflict`, DM unticks or forces); two hook points |
| C. Post-commit listener on `AttackApplied` issues a follow-up command | Decoupled | Contradicts ADR-0035 (no post-commit writes; crash gap); the hit's damage and the extra land in two steps; undo can't see it |

**Pick B.** The offered part carries its **settle facts** (target-side filters, `ask` note, soft tick) so the DM's popup settles from the card alone, without trigger rows. `roll` triggers (parts on the owner's own roll) run in the same roll hook and land at once; `turnStart` reminders run in a `combatRuleHooks` `turnChanged` line on Next and only `notify` (rules still never change HP by themselves, ADR-0016).

## Decision 2 — Trigger data and formula

| Option | Pros | Cons |
|---|---|---|
| **A. A `rule-trigger` table (owner = character or monster definition; `rule` JSON leaf: event, requires, filters, frequency, effect) + a hand-rolled formula grammar in `@shared` (pick)** | Passive features (Sneak Attack) and monster traits have a home; one strict zod; formula whitelist by construction, no dependency (mathjs removed, #151) | New table, record type, editor; we own ~150 lines of parser + tests |
| B. Triggers as a new modifier kind inside presets / effects | No new table | Passive triggers need always-on effects cluttering Active effects; per-combatant monster counters have no home |
| C. A dependency for formulas: `jsep` (MIT, ~10 KB min, parser only) or `expr-eval` (MIT, ~25 KB, evaluator) | Less parser code | A dependency needs the DM; still our whitelist / sandbox review (expr-eval had prototype-access issues) |

**Pick A.** Grammar: integers, `+ − * /`, parentheses, dice terms (`NdM`, `(expr)dM`, M ∈ 4–12, only as top-level addends), variables `level`, `prof`, `cr`, `str`…`cha`, functions `floor`, `ceil`, `min`, `max`, `steps`, `level(<class>)`; rounds down; evaluates to a FR-DICE-01 expression. Unsupported shapes (positions, weapon properties, creature types) are **`ask`** filters: the DM confirms in the popup.

## Decision 3 — Counters, resets, undo, Prev

| Option | Pros | Cons |
|---|---|---|
| **A. Window keys + server-only `trigger_use` rows (pick)**: a charge is free iff no `used` row for (trigger, owner combatant, encounter, key); key = turn `t:<round>:<turnCombatantId>` / round / encounter; `feature` frequency spends a CHARX use | Next / new round "reset" with no write; Prev returns to the old turn's uses as they were; Undo flips one row (and refunds a feature use); 0 B in the snapshot | Rows grow per encounter (DB only, ~0.6 KB each); a stale popup meets a `conflict` instead of a live "used" marker |
| B. Counter columns reset by the `turnChanged` hook | Simple reads | Prev must restore pre-reset values; per-combatant monster counters; more writes on every Next |
| C. Charges on the effect row (e.g. Rage) | No table | No home for passive or monster triggers |

**Pick A.**

## Decision 4 — Authoring, override, visibility

- **Authoring (pick):** DM; the owner for their own character unless the sheet is locked (as character presets, FR-MOD-07). Monster (definition) triggers: DM only. Rejected: DM only; owner proposes + DM approves.
- **Presets (pick):** six built-ins as code (Divine Fury, Sneak Attack, Hunter's Mark, Colossus Slayer, Martial Advantage, Regeneration), own words. Seams S5: built-ins list the compendium `featureKey`s (`<source>:<sourceKey>`) they implement; a compendium `feature` entry may carry `presetKey` or `preset` (a `TriggerRule`, MOD's zod, opaque to compendium); "Add to sheet" adds the trigger.
- **Override (pick):** chips per target in the DM's popup: tick, value edit, own multiplier (typed parts get their own defense preset), target Select; Force after a "used" conflict. Rejected: fold into the total; a second card.
- **Transport (seams S1, integrator pick; fallback: rows in the snapshot):** `rule-trigger` is a **lazy** record type (`lazy: "all"`): never in a snapshot; `sync.load` when a sheet's Triggers block, the editor, the Creatures / token entries or the roll preview opens; the server reads the DB.
- **Visibility (pick):** trigger rows to the DM and the owner; use rows never sent; part labels in public lines iff the trigger is `public` (default on for character triggers, off for monster triggers → "(DM)"); values public like any roll part (#190).

## Consequences

- AGENTS §9.9 append-only list gains `src/server/features/combat-tracker/apply-hooks.ts` (`applyHooks`) and `src/client/dm/features/combat-tracker/popup-parts.ts` (`popupParts`), both created empty by `fix/rt-core`; MOD adds lines to the existing `rollHooks`, `combatRuleHooks`, notification kinds / views, token menu, `creatureActions` and definition-changed hook registries.
- dice-roll-log: `RollSubject.card`, hook result `offered` (+ settle facts), pre-roll `modes()` (tier 2), part `type`, `manualParts`. combat-tracker: card `damage.triggers`, `applyCard.targets[].triggers`, `hp_change.triggerParts`, typed outcome parts. CHARX: `refundFeatureUse` beside `spendFeatureUse`. dice-extras (S4): MOD line in `tray-extras.ts`; request fields `subject`, `previewMode`, `manualParts`; offered trigger dice thrown inside the damage roll entry.
- Depends on the lazy-record-types ADR (`fix/lazy-records`) for the `rule-trigger` registration; if the DM rejects it, rows return to the snapshot (MOD OQ-MOD-28 fallback A).
- ADR-0016's "rules → pending actions" gains: rule triggers add **offered parts** the DM settles, and reminders; never post-commit writes.
- Glossary: Rule trigger, Offered part, Formula, Trigger window, Apply hook (MOD OQ-MOD-37).
- CON-44 (re-measured after S1): R costs **+23,718 B** in the realistic-heavy DM snapshot (699,754 B; was +30,549 with trigger rows in the snapshot); `rule-trigger` load ack ≤ 36,464 B at the campaign cap. The 100 KiB guard is still short (R alone by 15.7 KB): the orchestrator's gate-1 question (seams S2).
- Not covered (later): damage-taken / end-of-turn events, conditions or saves on hit, rerolls, position-aware filters, triggers created automatically from class or spell data.
