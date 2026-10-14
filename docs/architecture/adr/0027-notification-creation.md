# 0027 — Notifications are created in the causing command's transaction

- Status: accepted (2026-10-12; decisions-log #135, #136, #137). Refined by [ADR-0034](0034-encounter-scoped-notifications.md) and [ADR-0035](0035-combat-rule-hooks.md) (#178): rule hooks close C's crash gap
- Date: 2026-10-12
- Affects: [notifications](../../specs/notifications.md), [combat-tracker](../../specs/combat-tracker.md), [party-loot](../../specs/party-loot.md), [combat-extras](../../specs/combat-extras.md)
- Refines: [ADR-0016](0016-domain-events-pending-actions.md) ("MVP use: … damage cards" as a listener; open row "May rules mutate state directly?")

## Context

- ADR-0016 says rules create notifications, and lists damage cards among the MVP listeners. Listeners run after commit, and a failing listener never rolls back ([FR-SYNC-16](../../specs/live-sync.md#6-functional-requirements)).
- A notification written by a listener is a second write after the first commit. If the server dies in between, the attack is logged but its damage card is lost. That breaks "pending actions survive a crash".
- Resolving has the same problem the other way round: "apply damage" and "mark card resolved" must commit together, or a double click applies the damage twice.
- The command core already lets one command emit several domain events in one transaction (`env.emit`).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Helpers in the caller's transaction** (`notify`, `resolveNotification`, `reopenNotification`; each emits its own `Notification*` event) | Atomic with the cause and the effect; crash-safe; exactly-once resolve; no core change | The kind owner's command must call the helper explicitly (no "react to any event" yet) |
| B. Post-commit listener creates the notification via a follow-up command | Matches ADR-0016 wording; decoupled | Lost on a crash between commits; listener-issued commands need core support (re-entrancy, ordering before `ack`, depth cap) |
| C. A in MVP, B later for rule reactions | Fits MVP now; leaves room for concentration and durations | B's crash gap still has to be solved when it arrives |

## Decision

**C.** MVP uses A only: a notification is created (and resolved) inside the causing command's transaction via `notify` / `resolveNotification` (damage cards: the attack command, #135; loot received). Post-commit rule listeners (combat-extras) are decided when that spec is written, including how to close the crash gap. Only the DM resolves damage cards (#136).

## Consequences

- combat-tracker's player attack command calls `notify` (kind `damage-card`); its apply command calls `resolveNotification` in the same transaction; undo may call `reopenNotification`.
- party-loot's add command calls `notify` if it adopts `loot-received`.
- No MVP listener writes state. ADR-0016's "MVP use" line should read "damage cards: created by the attack command via `notify`".
- No change to `src/server/commands/` or `src/server/events/`.
