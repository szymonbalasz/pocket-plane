---
title: Dice and game log
prefix: DICE
status: unclaimed
owner: —
wave: 2
---

# Dice and game log

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Server-side dice rolling via `@dice-roller/rpg-dice-roller` ([ADR-0001](../architecture/adr/0001-tech-stack.md)).
- Persisted game log per campaign; survives crash ([ADR-0006](../architecture/adr/0006-persistence.md)).
- MVP: click-to-roll from sheet/combat, persisted log ([ADR-0014](../architecture/adr/0014-mvp-scope.md)).
- **Game log in the play view, BG2-style** (tier S): readable lines like *"Goblin attacks Mira: 12 + 4 = 16 — hit! 6 slashing damage."* Keeps combat fair and visible.
- **DM controls what's public, per roll category** (Shieldmaiden-style tickboxes, which are broken there today). On → players see those log lines; off → DM only.

## 2. Scope

- Roll from a dice expression (free text and click-to-roll from other features).
- **Manual entry**: any roll can instead be entered as a physical-dice result (DM and players). Logged and marked as manual ([ADR-0014](../architecture/adr/0014-mvp-scope.md)).
- **Roll categories**: attack, damage, saving throw, ability check, skill check, contested check, initiative, healing, other/free roll. *(List proposed; extensible.)*
- **Public log settings**: DM tickbox per category; changeable any time mid-session; applies live.
  - On → entries in that category appear in every player's game log.
  - Off → DM-only entries (players see nothing, or "DM rolled" — OQ-DICE-09).
- **Game log lines** composed from roll + context: actor, action, roll breakdown, total, outcome (hit/miss, save succeeded/failed, contest winner), damage. Covers out-of-combat rolls too (e.g. contested Strength).
- Game log is a window in the [play shell](play-shell.md), not an external feed or stream.
- Game log window, persisted and live-updated.
- Advantage/disadvantage on **any** roll: clickable toggle in the roll UI **or** modifier keys (**Shift = advantage, Ctrl = disadvantage**); roll labels/context (e.g. "Shortsword attack").
- **Design for later:** the log is a **game log** (Roll20-style), not roll-only. Entries are typed so text messages and pasted descriptions can join rolls later (chat tier C–D, [feature tiers](../feature-tiers.md#4-notes-handouts-world-and-party)).
- Every roll persisted with roller, context (attack/weapon, target if known), automated vs manual — feeds [stats](post-mvp/stats.md).

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

> TODO (spec phase).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-DICE-NN.

## 7. UI/UX notes

> TODO (spec phase): dice input, game log window (BG2-style line format), DM public-log settings panel (tickboxes), DM view (all entries, hidden ones marked) vs player view (public only). Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): roll (expression, result breakdown, roller, category, context link, automated/manual, timestamp); game log entry (typed; references roll/combat event); campaign public-log settings (category → public bool).

## 9. API & events

> TODO (spec phase): roll intent, roll event. Visibility rule per event: player rolls always public; DM rolls public iff their category is ticked at roll time (OQ-DICE-10). Settings change event visible to DM only.

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
| [campaign-management](campaign-management.md) | Roller identity; campaign settings | open |
| [combat-tracker](combat-tracker.md) | Attack/damage context, target, outcome | open |
| [play-shell](play-shell.md) | Game log window | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-DICE-03 | Dice seeding for tests | **Injectable RNG at server boundary** / mock library | yes | all specs using rolls |
| OQ-DICE-04 | Snapshot depth of game log | **Last N (e.g. 200), paginate older** / full | no | live-sync |
| OQ-DICE-05 | Rolls tagged by session? | Depends on [ADR-0013](../architecture/adr/0013-session-journal-scope.md) | no | campaign-management |
| OQ-DICE-06 | ~~Which roll visibility modes are MVP?~~ **Superseded: per-category public log settings in MVP** (whispers still tier C) | — | — | — |
| OQ-DICE-08 | Do category toggles apply to DM/monster rolls only, or player rolls too? | **DM/monster rolls only; player rolls always public** / both | yes | combat-tracker |
| OQ-DICE-09 | When a category is off, what do players see? | **Nothing** / "DM rolled something" line | no | — |
| OQ-DICE-10 | Toggling a category on: reveal past hidden entries? | **No; applies to new rolls. DM can reveal a single entry** / retroactive | no | live-sync |
| OQ-DICE-11 | Per-roll override at roll time (e.g. make this one hidden)? | **Yes, quick toggle in roll UI overrides the category default** / category only | no | — |
| OQ-DICE-12 | "Hit!" in the log: computed vs target AC, or DM's call? | **Computed vs target AC when target known; DM can override** / DM marks hit/miss / don't show | yes | combat-tracker |
| OQ-DICE-13 | Reveal monster stats in log lines (e.g. "vs AC 15", "+4")? | **Show roll + modifier and outcome, not the monster's AC** / show all / outcome only | no | combat-tracker |
| OQ-DICE-07 | Manual entry granularity: total only, or per-die? | **Total only, optional per-die** / per-die required | no | combat-tracker |

## 16. Out of scope

- 3D dice, inline rolls, macros, roll requests, whispers (→ [dice-extras](post-mvp/dice-extras.md)).
- Client-side authoritative rolling.
