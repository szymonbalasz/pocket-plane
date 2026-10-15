# Proposed — Effect modifiers: typed riders on effect rows, applied by a roll hook

- Status: accepted (DM gate 1, decision #190, 2026-10-15; raised by [effect-modifiers](../../specs/effect-modifiers.md) OQ-MOD-07, -08, -15, -17; DM note N9, #188). Integrator numbers it at merge.
- Date: 2026-10-15
- Affects: [effect-modifiers](../../specs/effect-modifiers.md), [combat-extras](../../specs/combat-extras.md), [dice-roll-log](../../specs/dice-roll-log.md), [combat-tracker](../../specs/combat-tracker.md), [character-sheet-full](../../specs/character-sheet-full.md), [data model](../../data-model/README.md), [protocol](../../protocol/README.md), [AGENTS §9.9](../../../AGENTS.md#99-shared-files)
- Refines: [ADR-0009](0009-entity-content-model.md) open row "Modifier model: design for later: instance → list of modifiers (field, op, value, source, duration)", with two differences: (1) the list is a JSON leaf on CBTX effect rows, not relational columns / rows on token or combatant; (2) modifiers apply as roll-time riders (and DM popup presets), not as "effective stats = definition + instance modifiers". [ADR-0035](0035-combat-rule-hooks.md) ("effects carry no numbers"). [ADR-0021](0021-sync-protocol-conventions.md) D for preset edits, as [ADR-0036](0036-full-sheet-derivation.md) did for sheet edits
- Consistent with: [ADR-0036](0036-full-sheet-derivation.md) (overrides decide the base), #134 / #136 (only the DM applies damage), #138 (no monster numbers to players)

## Context

- The DM's playtest (N9): Bless must add to attack rolls; a barbarian toggles Rage. Today effects are labels: the d4 is mental arithmetic.
- ADR-0009 planned a per-instance modifier list (field, op, value, source, duration); ADR-0035 put effects (conditions, labels, concentration) in CBTX's `effect` table and left numbers for later.
- Rolls are made in seven commands across three features (`char.roll`, `cbt.attack` (whole or to-hit only), `cbt.rollDamage` (P2a's split attack, `proposed-split-attack-damage.md` on its branch), `cbt.rollAbility`, `cbt.rollInitiative`, `cbtx.rollConcentration`, `cbtx.rollDeathSave`); all go through dice-roll-log's `dice.evaluate` inside their transaction. A card's to-hit and damage parts may be rolled in separate commands, so each part takes the modifiers active at its own commit.
- ADR-0036: sheet numbers are derived with overrides; an override replaces the derived value everywhere.
- Attacks are rolled before targets are picked (#134, #135); only the DM applies (#136).

## Decision 1 — Where modifiers live

| Option | Pros | Cons |
|---|---|---|
| **A. A typed `modifiers` list on the CBTX effect row (+ `presetKey`), copied from a preset at apply** | Every CBTX rule (expiry, Prev, undo restore, concentration end, End, hidden copy) carries them; one visibility fn; source and duration are the effect's | Changes CBTX's record (two columns) |
| B. A side table keyed by effect id | CBTX record untouched | Must mirror ended / hidden / secret on every CBTX rule path; a second visibility fn |
| C. Per-instance stat edits (ADR-0009's literal "field" on token / combatant) | Matches the old wording | PC play state lives on the character (ADR-0035); duplicates the effect's lifetime |

**A.** Modifier kinds: `dice` (signed NdM), `flat` (−10…10, on a roll selector or AC), `mode` (advantage / disadvantage), `defense` (resistance / vulnerability / immunity by damage type); ≤ 6 per effect; tier-tagged in built-in presets (a build ships only the parts of the tiers it has built). ADR-0009's tuple maps as: field = roll selector / damage types, op = kind, value = dice / value / mode / level, source and duration = the effect's.

## Decision 2 — Where they apply

| Option | Pros | Cons |
|---|---|---|
| **A. Roll side: an append-only `rollHooks` registry in dice-roll-log, run by `dice.evaluate` when the caller passes a `subject` (creature, roll kind, ability, via, crit); hooks return parts (extra dice as their own roll rows, flat values, modes). Target side: pure functions preset the DM's popup (effective AC, multiplier); the DM confirms** | One choke point already inside every roll transaction; callers add one field; later riders (gems, inspiration) register too; DM authority over damage kept | dice-roll-log gains a hook; each caller still adds parts to its own total and payload |
| B. A MOD helper each roll command calls explicitly (as `hpRules`) | Explicit call sites | Seven call sites own combine / crit / line logic; easy to miss one |
| C. A new hook point in ADR-0035's `combatRuleHooks` | Existing registry | Sheet rolls happen out of combat; it fires on lifecycle, not rolls |
| D. Apply resistances automatically at apply | Fewer clicks | Contradicts #134 / #136 (DM confirms every multiplier) |

**A.** Rules:

- **Riders, not derived values.** Modifiers never change `statBlock`, a derived value or an override. The base bonus is computed as today (an override wins); parts are added at roll time and named in the line ("+ 3 Bless").
- **In-transaction, from committed rows** (ADR-0035): the hook reads the creature's active effects at commit; bonus dice come from `ctx.dice`; a hook error rolls back the roll.
- **Visibility:** a part's label is public iff its effect is player-visible; otherwise "(DM)". PC effects carry modifiers to players who receive them, with `presetKey` redacted to built-in keys (no preset id reaches a player; toggle state lives on the owner's preset row); monster effects carry neither; AC and defense facts stay in `dmPayload`. A visible monster's part values show in public lines like any roll part.
- **Rolled values:** rolled = base + parts; bonus-die rows are identified as parts, never summed into the base, so an unedited Blessed attack never reads as "DM set".
- **Presets** are data: built-ins in `@shared` code (never sent); campaign rows customise a built-in by key; character rows (owner-editable unless the sheet is locked) are toggles, optionally spending a sheet feature use. Edited over WS for DM and owner (refines ADR-0021 D as ADR-0036 did).

## Consequences

- ADR-0009's "Modifier model" row: refined, "typed modifiers on effect rows, applied as roll-time riders; see this ADR" (the two differences above). ADR-0035's "effects carry no numbers" becomes "custom effects may carry modifiers".
- AGENTS §9.9 append-only list gains `src/server/features/dice-roll-log/roll-hooks.ts` (`rollHooks`).
- Glossary: Modifier redefined (typed entry on an effect, roll-time rider); Instance row updated (its "modifiers" are effects on the creature, not per-instance stat edits); Preset, Toggle, Roll hook added.
- Roll and card payloads gain optional `mods` / `modes`; old rows render unchanged. Bonus dice are ordinary `roll` rows (stats and gems need no schema change).
- Snapshot: preset rows and effect modifiers cost ≈ 13 KB in the heavy DM scenario (≈ 744 of 768 KiB, CON-44, M alone); the gate figure is one combined run after the P2a, P2b and M cores.
- Not covered (later): target-dependent riders at roll time, condition automation, a compendium-fed modifier list that changes derived values (ADR-0036 option D, before overrides).
