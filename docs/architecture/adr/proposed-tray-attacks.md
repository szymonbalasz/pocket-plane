# proposed — Attack and damage through the Dice tray: the intent carries the staged parts

- Status: accepted (DM, [#385](../../decisions-log.md), 2026-10-29; numbered at merge, ADR-0073 reserved). Raised by `spec/tray-attacks`
- Date: 2026-10-29
- Refines: [ADR-0037](0037-split-attack-damage.md) (split attack / damage: the Attack + damage action goes; cards can also start from a logged roll). Retires [FR-DICEX-31](../../specs/dice-extras.md#6-functional-requirements) ("notation never feeds attack / apply") and #188's third button ([FR-CHARX-41](../../specs/character-sheet-full.md#6-functional-requirements))
- Consistent with: [ADR-0016](0016-domain-events-pending-actions.md) (one command, one transaction, one event), [ADR-0038](0038-effect-modifiers.md) (roll hooks stay server-side), [ADR-0021](0021-sync-protocol-conventions.md) E (no optimistic intents), #134 / #136 (the DM applies every card), #190 (no crit out of combat)
- Affects: [character-sheet-full](../../specs/character-sheet-full.md), [dice-extras](../../specs/dice-extras.md), [dice-roll-log](../../specs/dice-roll-log.md), [combat-tracker](../../specs/combat-tracker.md); protocol, data model, glossary and AGENTS §9.9 at merge (build split: [CBT §14.8](../../specs/combat-tracker.md#148-build-split-sprint-15-tray-attacks))

## Context

- Today the server builds every sheet and combat roll from committed data: `char.roll`, `cbt.attack` and `cbt.rollDamage` are strict and carry no dice (`characterRolls` / `attackRollSpecs` from the row). The tray's `adjust` is read-only; any edit starts a fresh `free` request, which rolls `dice.roll` and never feeds a card (FR-DICEX-31).
- #385: Attack and Damage open the tray pre-filled and editable (upcast: + 1d6), Alt rolls at once, every roll has a **purpose** (plain / attack / damage) with a damage type per die group, the server doubles a crit at roll time, and the DM can **Use as attack / damage** a logged roll. "The server now takes the dice from the client."
- What must keep working, from the code:
  - **Mods and triggers**: `dice.evaluate` runs `rollHooks` when the caller passes a `subject` (`{creature, via, row, roll, crit?, card}`); mods attach to the to-hit and the **base part**; extra parts get no subject.
  - **Extra typed parts** (FR-CBT-81): card `damage` = base part + `extra[] {type, …}` ≤ 2; base `damageType` nullable, extra `type` required.
  - **Physical dice**: `manual` (to-hit + base), `manualExtra` (one per extra part), `manualParts` (MOD bonus-die boxes); each checked against its part's expression, doubled on a crit.
  - **Crit**: `critExpression` doubles each dice term's count; known from the card's `toHit.natural`.
  - **`unusedRolls`** (FR-CBT-92) and the pending-card match (`pendingCards`: same attacker, same row, `damage: null`).
  - **Gems reroll**: rerolls the d20 of a roll row; the card follows by `toHit.rollId` (`findToHitCard`); expressions come from the roll row.
  - **Roll guard** (FR-DICE-13): server-side per roll path, on the actor; dice content doesn't matter.
- No link from a log entry to a card exists; cards reference roll ids only.

## Decision 1 — How edited dice reach the server

| Option | Pros | Cons |
|---|---|---|
| **A. Staged parts on the existing intents**: `parts` = the row's parts after the edit; the row ref (`attackId` / `spellId`) stays; the server validates and rolls the parts instead of the derived ones; hooks, crit, manual checks as today | One field per intent; everything keyed on the row (label, MOD `row` filters, card `attackId`, pending match) keeps working; absent `parts` = today | The server trusts the dice (accepted by #385 (7): grammar and limits checked, the DM approves every card) |
| B. A delta: `extraDice` added to the server-derived parts | The base stays server-derived | Can't express a removed die or a changed constant; the "join a group" rule becomes server merge logic; free composed rolls still need A |
| C. Everything through `dice.roll {purpose}`; combat makes cards from purpose-tagged entries | One roll intent | Loses the row (MOD filters, card `attackId`, pending match); dice-roll-log would call combat inside its transaction (a new cross-feature hook); crit unknown at roll time |

**A.** Rules:

- **Shape** (`@shared/dice-roll-log`): `StagedPart {expression, type?}`, `parts?: StagedPart[]`.
  - **Attack** (`char.roll` `toHit` / `spellToHit`, `cbt.attack {rolls: "toHit"}`): exactly 1 part, exactly one `1d20` term, no `type`.
  - **Damage** (`char.roll` `damage` / `spellDamage`, `cbt.rollDamage`): 1–3 parts. Part 1 = the **base part** (`type` optional); parts 2–3 = **extra parts** (`type` required). Same as the row schema (FR-CHARX-54) and the card (no card schema change).
  - Each part passes FR-DICE-01; Σ dice over the damage parts ≤ **20** (a crit ≤ 40; the card-fit test proves 4 KB in slice S1).
- **Absent `parts`** = today: the server derives from the row. Alt-click (roll at once), request answers (`sheetRoll`, FR-CHARX-90) and existing tests send none.
- **Server** (one pure helper, `stagedSpecs(rowSpecs, parts)` in `@shared/character-sheet`): the row's specs with each expression replaced by the part's; label, category, `subject`, row ref unchanged. So roll hooks still run on the to-hit and the base part (Rage, Bless), extra parts get none, a crit doubles **every staged part** (`critExpression`), and manual entries are counted and checked against the staged parts (doubled on a crit). `manualParts` unchanged.
- **Rowless** combat rolls: `cbt.attack {rolls: "toHit"}` / `cbt.rollDamage` gain `rowless: true` + `label?` (needs `parts`, refuses `attackId` / `spellId`). Card without `attackId` / `spellId`, `attackName` = label or "Attack" / "Damage"; subject without `row` (MOD `row` filters don't match). **Pending match** (amends FR-CBT-71): same row, **or either side rowless**.
- **`dice.roll`** gains `purpose?` and, for damage, `parts?` in place of `expression`: one roll per part, one entry (FR-DICE-26). Out of combat this is only a label.
- **Every roll payload item** gains `purpose?` (`attack` \| `damage`; absent = plain), written by all four intents; damage items carry the built `part {type, extra}`, single-part rolls too.

## Decision 2 — Use as attack / damage from the log

| Option | Pros | Cons |
|---|---|---|
| **A. New DM command `cbt.useRoll {entryId, as, attackerId, types?}` builds or completes a card from the entry's rolls; the entry is stamped `dmPayload.usedByCardId`; the attacker and missing types are picked in the popup *before* the card exists** | No reroll; a card always has an attacker, so audience, pending match, Pending row, gems and apply are unchanged; idempotence = one stamp check; the stamp is DM-only through the existing redaction | Entries gain a second set-once field (after `supersededBy`); the popup gains a step before the card |
| B. A card with a nullable attacker, picked at Apply | No pre-card step | The attacker drives audience, pending match, Pending text, gems and apply lines; nullable everywhere |
| C. Idempotence by scanning cards for roll ids (no stamp) | No entry change | Unbounded scan of notification history; the DM client can't tell "used" (history is windowed) |

**A.** "Used" = the entry has `encounterId` (combat's own lines, old ones too) **or** `usedByCardId`. Items: the attack = the item tagged `attack`, else the first with a `natural`; the damage = items tagged `damage`, else every item without a `natural` (≤ 3). A crit card completed by Use as damage is **not** doubled (the dice are already rolled; [OQ-CBT-104](../../specs/combat-tracker.md#15-open-questions) pick A).

## Decision 3 — How a free composed roll reaches combat

| Option | Pros | Cons |
|---|---|---|
| **A. New append-only client registry `src/client/common/features/dice-extras/tray-routes.ts`; combat claims a `free` request with purpose attack / damage whose actor is an active combatant** | Same pattern as the sheet's roll routes; dice-extras never imports combat | One more registry (AGENTS §9.9) |
| B. Reuse CHARX's roll routes | No new registry | Keyed on `characterId`: no monster, token or combatant actors |
| C. Server-side inside `dice.roll` | No client seam | Decision 1 C's cons |

**A.**

## Consequences

- **CHARX:** two buttons (Attack, Damage); click stages, Alt rolls; `char.roll` gains `parts`; kinds `attack` / `spellAttack` stay readable and accepted (no client sends them).
- **DICEX:** `adjust` is editable for attack / damage controls; purpose toggle, type per die group, crit badge; `RollRequest` gains `parts`; the Alt hint on those buttons reads "Alt: roll now". FR-DICEX-31 retired.
- **DICE:** `dice.roll` gains `purpose` / `parts`; payload items gain `purpose`; roll-kind `dmPayload` gains `usedByCardId`; DM entry actions "Use as attack" / "Use as damage" (combat-owned lines in `entry-actions.ts`).
- **CBT:** `parts`, `rowless`, `label` on `cbt.attack` / `cbt.rollDamage`; new `cbt.useRoll` and event `RollUsed`; the popup's "Use roll" step; Initiative **Attack ▸** offers two actions. `cbt.attack` without `rolls` (both) stays accepted, unused by clients.
- **Trust:** a player can roll any legal dice as their weapon. The line shows the expression, and an **edited** mark when it differs from the row ([OQ-CHARX-51](../../specs/character-sheet-full.md#15-open-questions)); the DM still applies every card.
- **Unchanged:** card schema, `unusedRolls`, gems (a reroll rerolls the stored expression's d20; a used entry's card follows by `toHit.rollId`), the roll guard (it reads the actor, and `cbt.useRoll` writes no roll entry), stats (rolls count by `rollIds`).
- **Outside these specs:** [kit-parity FR-KIT-105](../../specs/post-mvp/kit-parity.md) (stat-block buttons), [character-sheet](../../specs/character-sheet.md) §13 and [effect-modifiers](../../specs/effect-modifiers.md) §13 walkthrough steps that click Attack + damage, glossary rows ([OQ-CBT-103](../../specs/combat-tracker.md#15-open-questions)).
