# Proposed — Combat rules run in the causing command's transaction

- Status: proposed (spec-combat-extras, [OQ-CBTX-01](../../specs/combat-extras.md#15-open-questions)); number at merge
- Date: 2026-10-14
- Affects: [combat-extras](../../specs/combat-extras.md), [combat-tracker](../../specs/combat-tracker.md), [character-sheet](../../specs/character-sheet.md), [notifications](../../specs/notifications.md), [AGENTS §9.9](../../../AGENTS.md#99-shared-files)
- Refines: [ADR-0009](0009-entity-content-model.md) (where instance play state and modifiers live; see "Refines ADR-0009" below), [ADR-0016](0016-domain-events-pending-actions.md) ("Rules → pending actions" as listeners; open row "May rules mutate state directly?"), [ADR-0027](0027-notification-creation.md) C ("post-commit rule listeners … decided when combat-extras is written, including how to close the crash gap")

## Context

- combat-extras needs rules that react to combat changes: effect expiry on Next (and restore on Prev), concentration cards on damage, concentration ending at 0 HP, death-save failures on damage at 0 HP, temp HP absorbing damage, effects ending at End.
- ADR-0016 draws rules as post-commit listeners. Listeners run after commit and never roll back ([FR-SYNC-16](../../specs/live-sync.md#6-functional-requirements)). A rule that writes after commit leaves a crash gap: damage applied, card lost; Next committed, Bless never expired.
- Temp HP absorption and death-save failures are not reactions at all: they change how much HP the damage removes, so they must run **before** the HP write.
- The repo already solves the same problem twice with in-transaction hooks: definition-changed (FR-ENT-19) and token-changed hooks ([ADR-0028](0028-token-changed-hooks.md), [ADR-0031](0031-token-move-hooks.md)).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. In the causing command's transaction: an HP rules helper (`hpRules.apply` / `revert`) on every damage / heal path, plus an append-only `combatRuleHooks` registry (`started`, `added`, `turnChanged`, `ended`) that combat commands run in their transaction; rows go into the causing event's `changes`; hooks may call `notify`** | Atomic, crash-safe by construction; undo sees every effect of an apply; same pattern as ADR-0028; no core change | combat-tracker and character-sheet commands call the helper / registry explicitly; a slow hook slows the command |
| B. Post-commit listener issues a follow-up command; boot-time reconciliation recomputes missed reactions | Matches ADR-0016's picture; decoupled | Needs core re-entrancy, ordering before `ack`, depth cap; reconciliation must be idempotent per rule; absorption still can't be post-commit |
| C. A for HP math, B for expiry / prompts | Expiry decoupled | Two mechanisms; B's crash gap remains for expiry |

## Decision (proposed)

**A.** Rules never write state after commit. `hpRules` (combat-extras, server) is the only path that changes HP, temp HP and death saves from damage or healing (callers: `cbt.applyCard`, `cbt.applyHp`, `cbt.undo`, `char.adjustHp`). `combatRuleHooks` lives in `src/server/features/combat-tracker/rule-hooks.ts`, created empty by the combat-extras build, append-only (AGENTS §9.9). A hook error rolls back the command. ADR-0016's open row "May rules mutate state directly?" is answered: **only inside the causing command's transaction, never from a listener**.

## Refines ADR-0009

ADR-0009 puts play state and modifiers (temp HP, buffs / debuffs) "as relational columns / rows on token / combatant", with "instance → list of modifiers (field, op, value, source, duration)" as design-for-later. combat-extras refines this without contradicting it:

- **Monster** play state (`tempHp`) is a column on the combatant, as ADR-0009 says.
- **PC** play state (`tempHp`, `deathSuccesses`, `deathFailures`) lives on the character entity, as `hpCurrent` already does (#92), because it outlives one encounter and the sheet shows it outside combat (orchestrator's D/S seam).
- **Effects** (conditions, labelled custom effects, concentration) are rows in a new `effect` table targeting a combatant (monster) or a character (PC). They carry no numbers. ADR-0009's field / op / value modifiers stay design-for-later; "Effect" replaces the glossary's "Modifier" for these rows (OQ-CBTX-19).

## Consequences

- ADR-0027 C closes: no post-commit rule listeners. Rule notifications (`cbtx-concentration`, `cbtx-expired`) are created with `notify` in the causing transaction, after the owner's event.
- ADR-0016 "MVP use" gains: "rules run as in-transaction hooks (combat-rule-hooks); listeners stay broadcaster + event log".
- AGENTS §9.9 append-only list gains `combatRuleHooks`.
- Hooks must be cheap (indexed reads of the started encounter's rows); they run on every Next and every apply.
