---
title: <Feature name>
prefix: <PREFIX>            # used in FR-<PREFIX>-NN and OQ-<PREFIX>-NN
status: unclaimed           # unclaimed → claimed → draft → in-review → complete
owner: —                    # worktree name once claimed
wave: <n>                   # see ../roadmap.md
---

# <Feature name>

> **Guideline:** target **five minutes** to read. Bullets over prose. Tables where they help. Use [glossary](../glossary.md) terms. UI styling → [visual-direction](../design/visual-direction.md). Unknowns → Open questions, never invented as decided. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- What this is, in 2–3 bullets.

## 2. Scope

- Capabilities included in MVP for this feature.
- Items marked *(proposed)* were inferred, not in the kickoff brief — confirm or drop.

## 3. Goals

- Outcomes this feature must achieve.

## 4. Non-goals

- Things this feature deliberately will not do (ever, or by ADR).

## 5. User stories

**DM**
- As the DM, I want … so that …

**Player**
- As a player, I want … so that …

## 6. Functional requirements

Each one testable.

| ID | Requirement | Notes |
|---|---|---|
| FR-<PREFIX>-01 | | |

## 7. UI/UX notes

Reference [visual-direction](../design/visual-direction.md). No custom styling.

- **Screens:** …
- **States:** empty, loading, error, disconnected.
- **DM view:** …
- **Player view:** …

## 8. Data model

Entities, not SQL. JSON leaf fields marked per [ADR-0006](../architecture/adr/0006-persistence.md).

| Entity | Field | Type | Notes |
|---|---|---|---|

- **Relations:** …
- **Derived values:** …
- **Persisted runtime state:** …

## 9. API & events

**REST (Hono RPC)**

| Method | Path | Who | Purpose |
|---|---|---|---|

**WS intents (client → server)**

| Intent | Who | Validation / ownership |
|---|---|---|

**WS events (server → client)**

| Event | Payload | Visibility rule |
|---|---|---|

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** …
- **DM disconnect / reconnect:** …
- **Server crash mid-action:** …
- **Concurrent edits:** …
- **Invalid / malicious input:** …

## 12. Performance & bandwidth

- Expected sizes, update rates, payload budgets. Remember DM upload via tunnel ([ADR-0003](../architecture/adr/0003-local-hosting.md)).

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)).

| Level | What | Fixtures |
|---|---|---|
| Unit | | |
| Integration | | |
| E2E (thin) | | |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-<PREFIX>-01 | | | | |

## 16. Out of scope

- Deferred to later or owned by another spec (link it).
