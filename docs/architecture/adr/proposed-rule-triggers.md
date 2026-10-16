# ADR-0043 — Rule triggers: conditional, event-driven modifiers (class features like Divine Fury)

- Status: **accepted (#207, 2026-10-16)**. Need decided by the DM (#203); every pick below accepted at sprint-3 gate 1 (#207), presets changed by #209 (five built-ins, no non-SRD built-in), snapshot guard by #208. The integrator renames this file to `0043-rule-triggers.md` at merge
- Date: 2026-10-16
- Refines: [ADR-0038](0038-effect-modifiers.md) (effect modifiers: static roll-time riders via `rollHooks`), [ADR-0035](0035-combat-rule-hooks.md) (combat rule hooks in the causing command's transaction), [ADR-0016](0016-domain-events-pending-actions.md) (domain events), [ADR-0037](0037-split-attack-damage.md) (a card's damage may be rolled after its to-hit)
- Not a plugin system ([ADR-0007](0007-product-scope.md) Out "extension / plugin system"): triggers are data interpreted by built-in code, not user code
- Uses: [ADR-0045](0045-lazy-record-types.md) (lazy record types) for `rule-trigger`
- Affects: [effect-modifiers](../../specs/effect-modifiers.md) (FR-MOD-32–52), [combat-tracker](../../specs/combat-tracker.md), [combat-extras](../../specs/combat-extras.md), [character-sheet-full](../../specs/character-sheet-full.md), [dice-roll-log](../../specs/dice-roll-log.md), [live-sync](../../specs/live-sync.md) (lazy type), dice-extras, compendium, [notifications](../../specs/notifications.md), [AGENTS §9.9](../../../AGENTS.md#99-shared-files)

## Context

- MOD tier 1 applies static parts (bonus dice, flat bonuses) to every matching roll while an effect is active.
- The DM's table needs conditional riders. Reference case (#203), **Zealot barbarian, Divine Fury**: while raging, the first creature hit on each of the barbarian's turns with a weapon attack takes **+1d6 + half the barbarian level** radiant (or necrotic) damage. "There are going to be a lot of customisations like this", so the model must be general.
- A hit is only known when the DM applies a card (#134, #136); the damage is rolled earlier, at the card (ADR-0037). Cards are notifications: player-safe payload, no DM-only part.
- CON-44: at spec time the heavy DM snapshot had ~8 KB above the 100 KiB headroom guard (measured, MOD §12); #208 since dropped the guard and set the DM ceiling to 1 MiB.
- Seams pass (orchestrator, 2026-10-16): on-demand data uses one generic path, [ADR-0045](0045-lazy-record-types.md) (S1); this ADR adds no load path of its own. Rulings pass (review-b R1–R14, same day) applied below.

## What a trigger needs (from the reference case)

| Part | Divine Fury | Model (MOD §8.4) |
|---|---|---|
| Owner / source | A feature of the character | `rule-trigger` row on a character or a monster definition |
| Requires | An active effect (Rage) | `requires.preset` = the effect's `presetKey` |
| Event | An attack that **hits** | `on: hit` (also `roll`, `turnStart`) |
| Filter | Weapon attack, on the owner's turn | `when: [via weapon, ownTurn]` (+ row, crit, mode, target marked / hurt, `ask`) |
| Frequency | Once per turn | `every: turn` (each / round / encounter / a feature's uses) |
| Effect | Damage part `1d6 + floor(level(barbarian) / 2)` radiant | `then: {do: damage, formula, type}` (+ roll part, mode, reminder) |
| Visibility / undo | As modifier parts; undo restores the charge | per-trigger `public`; window keys + use rows |

## Decision (summary, #207)

- **D1** B: offered at the damage roll, settled at apply, both in the causing command's transaction.
- **D2** A: `rule-trigger` table + hand-rolled formula grammar, no dependency.
- **D3** A: window keys + server-only `trigger_use` rows.
- **D4** DM + owner (unless locked) author; **five built-in presets, all SRD** (#209); per-target chips with Force; per-trigger `public`; `rule-trigger` lazy (ADR-0045).
- Rejected options stay below for the record.

## Decision 1 — Where triggers run

| Option | Pros | Cons |
|---|---|---|
| A. Everything at apply: `cbt.applyCard` rolls the extra dice for each hit target | Hit known exactly; one place | The player never rolls those dice (physical dice, 3D tray); the popup can't show the number before apply; crit handled twice |
| **B. Offered at the damage roll, settled at apply (decided)**: MOD's roll hook rolls a passing `hit` trigger with the card's damage and records it as an **offered** part (card + server-only use row); `cbt.applyCard` runs a new append-only **`applyHooks`** registry per target that lands each ticked part on one hit target and spends the charge; `cbt.undo` runs the hook's `revert` | Both steps in the causing command's transaction (ADR-0035): crash-safe, undoable; the player rolls with their damage; the DM sees the number and overrides it; crit doubling comes free | A card can show a part that never lands (miss, charge used by another card first → `conflict`, DM unticks or forces); two hook points |
| C. Post-commit listener on `AttackApplied` issues a follow-up command | Decoupled | Contradicts ADR-0035 (no post-commit writes; crash gap); the hit's damage and the extra land in two steps; undo can't see it |

**Decided: B (#207).** The offered part sits on the damage `roll` entry (`offered`, not in the total, per-die `dice` so the tray throws it) and on the card with its **settle facts** (target-side filters, `ask` note, soft tick), so the DM's popup settles from the card alone, without trigger rows. A `mode` filter reads the card's to-hit mode (damage-only card = normal). Offering **never fails the roll**: a formula over 25 dice (50 on a crit), > 4 offers or a card over 4 KB skip the trigger with a DM-only note; physical `t:` dice groups are lenient (surplus ignored, missing server-rolled), because charges are server-only. `roll` triggers (parts on the owner's own roll) run in the same roll hook and land at once; `turnStart` reminders (`every: each` only) run in a `combatRuleHooks` `turnChanged` line on Next, "Start round 1" included, and only `notify` (rules still never change HP by themselves, ADR-0016).

## Decision 2 — Trigger data and formula

| Option | Pros | Cons |
|---|---|---|
| **A. A `rule-trigger` table (owner = character or monster definition; `rule` JSON leaf: event, requires, filters, frequency, effect) + a hand-rolled formula grammar in `@shared` (decided)** | Passive features (Sneak Attack) and monster traits have a home; one strict zod; formula whitelist by construction, no dependency (mathjs removed, #151) | New table, record type, editor; we own ~150 lines of parser + tests |
| B. Triggers as a new modifier kind inside presets / effects | No new table | Passive triggers need always-on effects cluttering Active effects; per-combatant monster counters have no home |
| C. A dependency for formulas: `jsep` (MIT, ~10 KB min, parser only) or `expr-eval` (MIT, ~25 KB, evaluator) | Less parser code | A dependency needs the DM; still our whitelist / sandbox review (expr-eval had prototype-access issues) |

**Decided: A (#207).** Grammar: integers, `+ − * /`, parentheses, dice terms (`NdM`, `(expr)dM`, M ∈ 4–12, only as top-level addends), variables `level`, `prof`, `cr`, `str`…`cha`, functions `floor`, `ceil`, `min`, `max`, `steps`, `level(<class>)`; a die size may be a formula evaluating to 4–12 (#209); rounds down; evaluates to a FR-DICE-01 expression of ≤ 25 dice (checked at save). `requires` matches a preset by key, id or the preset's `originKey` (a character preset started from built-in Rage also matches `rage`). Unsupported shapes (positions, weapon properties, creature types) are **`ask`** filters: the DM confirms in the popup. A `row` filter names the attack / spell rows a trigger applies to (`RollSubject.row`; #209). Coverage check of 20 class features (#209, MOD §8.7): 12 expressible, 4 with `ask`, 4 out.

## Decision 3 — Counters, resets, undo, Prev

| Option | Pros | Cons |
|---|---|---|
| **A. Window keys + server-only `trigger_use` rows (decided)**: a **charge** (one use of a trigger in its window) is free iff no `used` row for (trigger, owner combatant, encounter, key); key = turn `t:<round>:<turnCombatantId>` / round / encounter; `feature` frequency spends a CHARX use | Next / new round "reset" with no write; Prev returns to the old turn's uses as they were; Undo flips one row (and refunds a feature use); 0 B in the snapshot | Rows grow per encounter (DB only, ~0.6 KB each); a stale popup meets a `conflict` instead of a live "used" marker |
| B. Counter columns reset by the `turnChanged` hook | Simple reads | Prev must restore pre-reset values; per-combatant monster counters; more writes on every Next |
| C. Charges on the effect row (e.g. Rage) | No table | No home for passive or monster triggers |

**Decided: A (#207).**

## Decision 4 — Authoring, override, visibility

- **Authoring (decided):** DM; the owner for their own character unless the sheet is locked (as character presets, FR-MOD-07). Monster (definition) triggers: DM only. Rejected: DM only; owner proposes + DM approves.
- **Presets (decided, #209):** **five** built-ins as code, all SRD-based, own words: Sneak Attack, Hunter's Mark, Colossus Slayer, Martial Advantage, Regeneration. **No non-SRD built-in** (ADR-0018): Divine Fury (Xanathar's) stays the acceptance test as **trigger data** on a fixture character, no subclass name in code. Real class / subclass data comes later from a 5etools import mapped onto `TriggerRule` (`ask` where the model can't). Rejected: six built-ins incl. Divine Fury (gate pick G23); homebrew fixture only via the compendium. Seams S5: built-ins list the compendium `featureKey`s (`<source>:<sourceKey>`) they implement; a compendium `feature` entry may carry `presetKey` or `preset` (a `TriggerRule`, MOD's zod, opaque to compendium); compendium's `cmp.addToSheet` adds the sheet row and calls MOD's `addTriggerFromPreset(env, characterId, from)` in one transaction (no own transaction, no event).
- **Override (decided):** chips per target in the DM's popup: tick, value edit, own multiplier (typed parts get their own defense preset), target Select; Force after a "used" conflict. Rejected: fold into the total; a second card.
- **Transport (seams S1; ADR-0045 accepted, #207):** `rule-trigger` is a **lazy** record type (`lazy: "all"`): never in a snapshot; `sync.load` when a sheet's Triggers block, the editor, the Creatures / token entries or the roll preview opens; the server reads the DB.
- **Visibility (decided):** trigger rows to the DM and the owner (a campaign preset id in `requires` or `targetMarked` redacted to its name for players); use rows never sent; part labels in public lines iff the trigger is `public` (default on for character triggers, off for monster triggers → "(DM)"); values public like any roll part (#190).

## Consequences

- AGENTS §9.9 append-only list gains `src/server/features/combat-tracker/apply-hooks.ts` (`applyHooks`) and `src/client/dm/features/combat-tracker/popup-parts.ts` (`popupParts`), both created empty by `fix/rt-core`; MOD adds lines to the existing `rollHooks`, `combatRuleHooks`, notification kinds / views, token menu, `creatureActions` and definition-changed hook registries.
- dice-roll-log: `RollSubject.card`, `RollSubject.row` (#209), hook result `offered` (+ settle facts) and `notes`, payload item `offered` and per-die `dice` on parts, pre-roll `modes()` (tier 2), part `type`, `manualParts`. combat-tracker: card `damage.triggers`, `applyCard.targets[].triggers`, `hp_change.triggerParts`, typed outcome parts. CHARX: `refundFeatureUse` beside `spendFeatureUse`. MOD: `effect_preset.origin_key`. dice-extras (S4, R14): MOD line in `tray-extras.ts`; `subject` in roll-control options, `RollRequest` fields `previewMode`, `manualParts`; offered trigger dice thrown from the damage roll entry. compendium: `cmp.addToSheet` calls `addTriggerFromPreset`.
- Depends on ADR-0045 (`fix/lazy-records`) for the `rule-trigger` registration.
- ADR-0016's "rules → pending actions" gains: rule triggers add **offered parts** the DM settles, and reminders; never post-commit writes.
- Glossary: Rule trigger, Offered part, Formula, Trigger window, Charge, Apply hook (MOD OQ-MOD-37).
- CON-44 (re-measured in the rulings pass): R costs **+36,868 B** in the realistic-heavy DM snapshot (712,913 B; +23,718 after S1, +30,549 with trigger rows in the snapshot); the damage roll entry's `offered` part is +11,940 of it. `rule-trigger` load ack ≤ 36,464 B at the campaign cap (≈ 40,900 B with one `row` filter, estimated). **#208:** the 100 KiB headroom guard is dropped, the DM ceiling is 1 MiB (players 512 KiB); tests assert the ceilings plus each feature's own bounds (MOD §12).
- Not covered (later): damage-taken / end-of-turn / movement events, conditions or saves on hit, rerolls and die-face changes, position-aware filters, a row's base die, triggers created automatically from class or spell data (5etools import, compendium-expansion).
