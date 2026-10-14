# 0034 — Pending combat notifications end with their encounter, per kind

- Status: accepted (2026-10-14; decisions-log #178; raised by spec-polish-r, sprint-1 R5, [OQ-CBT-45](../../specs/combat-tracker.md#15-open-questions))
- Date: 2026-10-14
- Affects: [notifications](../../specs/notifications.md) (FR-NOTE-23, 24), [combat-tracker](../../specs/combat-tracker.md) (FR-CBT-59), [combat-extras](../../specs/combat-extras.md) (its kinds choose; OQ-CBTX-15)
- Refines: [ADR-0016](0016-domain-events-pending-actions.md) (a pending action waits "until resolved or dismissed"), [ADR-0027](0027-notification-creation.md) (notifications change in the causing command's transaction)

## Context

- Session-sim-3 (#176, R5): after End encounter a pending damage card keeps its sticky toast and the DM's bell badge. It can't be applied any more (`cbt.applyCard` after End → `conflict`, FR-CBT-10), so it is pure leftover.
- combat-extras adds more combat kinds. Some must outlive the encounter (a concentration card, OQ-CBTX-15: concentration outlives combat); others are meaningless after it.
- Notifications have no expiry by design (no wall-clock timers, ADR-0016). End is a game-time event, so closing rows on End is not a timer.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Per-kind opt-in: an end rule `{onEncounterEnd: "dismiss", encounterIdOf(payload)}`, a shared constant (`@shared/<feature>`) used by the server kind and its client views; the ending command calls `dismissForEncounter(env, encounterId)` in its transaction** | One rule for every combat kind; each kind decides; crash-safe (same transaction); clients can count what End will close; reuses `dismissed` and `NotificationDismissed` (no new state, column or event) | Opting-in kinds must say where their encounter id is; one more helper call in `cbt.end` |
| B. Keep: the DM dismisses by hand (as built) | No change | Leftover toast + badge after every fight with an unapplied card |
| C. Ask in the End confirm (checkbox "Dismiss N pending cards") | DM chooses | A choice with no use: a kept card can't be applied after End |
| D. Combat dismisses its own cards in `cbt.end` by kind name, no registry field | Smallest code | No general rule; combat-extras would hard-code kinds in combat-tracker |

## Decision

**A** (DM, #178). `damage-card` opts in. Kinds that don't declare it keep today's rule (pending until resolved or dismissed). The helper dismisses only `pending` rows of the campaign whose kind opts in and whose `encounterIdOf(payload)` matches, one `NotificationDismissed` each, after the ending command's own event (and, with combat-extras, after its `NotificationResolved` rows; order in FR-CBT-61). Handled action rows no longer count as unread (FR-NOTE-24), so the bell clears too.

## Consequences

- notifications: FR-NOTE-23 (end rule type, load check + helper), FR-NOTE-24 (unread). combat-tracker: FR-CBT-59 (`DAMAGE_CARD_END_RULE`; `cbt.end` calls the helper; the confirm counts only kinds with the rule), FR-CBT-61 (event order).
- combat-extras: each new kind states whether it has an end rule (concentration: none, so it stays pending, matching OQ-CBTX-15). [ADR-0035](0035-combat-rule-hooks.md) is accepted too (#178): the call may move into an `ended` hook; same transaction, same order (FR-CBT-61).
- protocol §23 kind table gains the column. No DB, event or record-type change.
- ADR-0016 "pending until resolved or dismissed" stands: dismissal on End is a dismissal by the DM's End command.
