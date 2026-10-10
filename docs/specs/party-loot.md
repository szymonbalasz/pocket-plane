---
title: Party loot
prefix: LOOT
status: unclaimed
owner: —
wave: 3
---

# Party loot

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- DM gives a reward to the party; every player sees it in a shared **party loot** log ([ADR-0014](../architecture/adr/0014-mvp-scope.md)).
- Form isn't fixed to gold: the point is a visible record that the party received something.
- Smallest slice of the [party board](post-mvp/party-board.md).

## 2. Scope

- DM adds a loot entry to the party: description, optional quantity/coin amount, timestamp.
- All players and DM see the log, live-updated.
- Persisted; survives crash ([ADR-0006](../architecture/adr/0006-persistence.md)).
- Running coin total *(proposed)*.

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

- Party inventory management, item transfer to characters, handouts (→ [party-board](post-mvp/party-board.md)).
- Per-character currency (→ [character-sheet-full](post-mvp/character-sheet-full.md)).

## 5. User stories

> TODO (spec phase): DM ("award 50 gp after the fight"), player ("see what we got").

## 6. Functional requirements

> TODO (spec phase): FR-LOOT-NN.

## 7. UI/UX notes

> TODO (spec phase): where the log lives (panel/tab), DM add form, toast on new loot. Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): loot entry (campaign, description, amount?, created at, created by).

## 9. API & events

> TODO (spec phase). Visibility rule per event (all players).

## 10. Permissions

> TODO (spec phase): DM writes; players read.

## 11. Edge cases & failure modes

> TODO (spec phase): DM edits/deletes an entry, player offline when loot given (sees on snapshot).

## 12. Performance & bandwidth

> TODO (spec phase).

## 13. Test plan

> TODO (spec phase): fixture `session-sim` + "post-combat" bundle. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | Events, snapshot | open |
| [campaign-management](campaign-management.md) | Campaign scope | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-LOOT-01 | Entry shape | **Free text + optional coin amount (gp/sp/cp)** / free text only / structured items | yes | post-mvp/party-board |
| OQ-LOOT-02 | Can entries be edited/removed? | **DM can edit/delete; no history** / append-only with corrections | no | — |
| OQ-LOOT-03 | Can players add entries (e.g. found loot themselves)? | **No in MVP** / yes | no | — |
| OQ-LOOT-04 | Can an entry reference an entity (item) later? | **Leave room (nullable ref), not in MVP** / no | no | post-mvp/world-builder |

## 16. Out of scope

- See §4 Non-goals.
