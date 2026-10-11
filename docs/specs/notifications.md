---
title: Notifications
prefix: NOTE
status: unclaimed
owner: —
wave: 2
---

# Notifications

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Toast-like messages with a persisted **history** feed, for DM and players.
- Some are reminders/info; some carry an **action** (button) for the DM or a player → a **pending action** until resolved.
- One concept for damage cards, reminders and prompts ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). Created by domain-event listeners.

## 2. Scope

- Notification: kind, audience (DM / one player / all), text, optional action, status (open / resolved / dismissed), timestamps.
- Toast on arrival; history feed window on the play page.
- Actions may require a roll: automated or manual ([dice-roll-log](dice-roll-log.md)).
- Persisted; survives crash; included in snapshot.
- MVP kinds: damage card ([combat-tracker](combat-tracker.md)). Loot received ([party-loot](party-loot.md)) *(proposed)*.
- Extension point: features register new kinds (concentration, durations, turn reminders post-MVP).

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

- Wall-clock timers / scheduling ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)).
- Chat (→ not planned; raise if needed).
- Browser/OS push notifications.

## 5. User stories

> TODO (spec phase): DM ("see pending damage cards and apply them"), player ("see what happened while I was tabbed out").

## 6. Functional requirements

> TODO (spec phase): FR-NOTE-NN.

## 7. UI/UX notes

> TODO (spec phase): toast behaviour, history window, pending vs resolved styling, action buttons. DM vs player view. Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): notification (kind, audience, actor, payload JSON leaf per kind, action, status).

## 9. API & events

> TODO (spec phase): create (server-only via listeners), resolve, dismiss. Visibility rule = audience.

## 10. Permissions

> TODO (spec phase): only the named actor can resolve; DM can dismiss anything.

## 11. Edge cases & failure modes

> TODO (spec phase): actor offline, two clicks on one action (idempotent resolve), target gone before resolve, crash between resolve and effect.

## 12. Performance & bandwidth

> TODO (spec phase): history size in snapshot; pagination.

## 13. Test plan

> TODO (spec phase): fixture with open damage card; resolve idempotency; crash-resume. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md) | Event bus, concept | accepted (core) |
| [live-sync](live-sync.md) | Visibility filter, snapshot | open |
| [dice-roll-log](dice-roll-log.md) | Roll-backed actions | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-NOTE-01 | Resolver: named actor only, or anyone in audience? | **Named actor; DM can always act** / anyone in audience | yes | combat-tracker |
| OQ-NOTE-02 | Is the game log itself a notification feed, or separate? | **Separate windows; rolls may spawn notifications** / merged feed | no | dice-roll-log |
| OQ-NOTE-03 | History retention | **Whole campaign, paginated** / current session only | no | — |
| OQ-NOTE-04 | Do toasts auto-dismiss? | **Info auto-dismiss; pending actions stay until resolved** / all sticky | no | — |

## 16. Out of scope

- See §4 Non-goals.
