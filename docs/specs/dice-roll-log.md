---
title: Dice and roll log
prefix: DICE
status: unclaimed
owner: —
wave: 2
---

# Dice and roll log

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Server-side dice rolling via `@dice-roller/rpg-dice-roller` ([ADR-0001](../architecture/adr/0001-tech-stack.md)).
- Persisted roll log per campaign; survives crash ([ADR-0006](../architecture/adr/0006-persistence.md)).
- Public and whisper rolls; DM broadcast controls.

## 2. Scope

- Roll from a dice expression (free text and click-to-roll from other features).
- Public rolls and whispers.
- DM broadcast controls over roll visibility.
- Roll log view, persisted and live-updated.
- Advantage/disadvantage, roll labels/context (e.g. "Longsword attack"). *(proposed)*

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

> TODO (spec phase).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-DICE-NN.

## 7. UI/UX notes

> TODO (spec phase): dice input, log panel, whisper indicator. DM vs player view. Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): roll (expression, result breakdown, roller, visibility, context link, timestamp).

## 9. API & events

> TODO (spec phase): roll intent, roll event. Visibility rule per event (public / whisper / DM-hidden).

## 10. Permissions

> TODO (spec phase).

## 11. Edge cases & failure modes

> TODO (spec phase): invalid expression, huge expressions (`1000d1000`), disconnect between roll and result, log growth.

## 12. Performance & bandwidth

> TODO (spec phase): snapshot includes how many log entries?

## 13. Test plan

> TODO (spec phase): seeded RNG fixture. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | Event/visibility conventions | open |
| [campaign-management](campaign-management.md) | Roller identity | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-DICE-01 | What do "DM broadcast controls" cover? | **DM rolls hidden by default, reveal per roll; DM can make any roll public** / global toggle only | yes | combat-tracker |
| OQ-DICE-02 | Whisper semantics: player→DM, DM→player, player→player? | **Player→DM and DM→player only** / any | yes | live-sync |
| OQ-DICE-03 | Dice seeding for tests | **Injectable RNG at server boundary** / mock library | yes | all specs using rolls |
| OQ-DICE-04 | Snapshot depth of roll log | **Last N (e.g. 200), paginate older** / full | no | live-sync |
| OQ-DICE-05 | Rolls tagged by session? | Depends on [ADR-0013](../architecture/adr/0013-session-journal-scope.md) | no | campaign-management |

## 16. Out of scope

- 3D dice / animations.
- Client-side authoritative rolling.
