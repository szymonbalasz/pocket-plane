---
title: Combat tracker
prefix: CBT
status: unclaimed
owner: —
wave: 3
---

# Combat tracker

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- MVP: **build an encounter with CR difficulty**, then run a fight against **one or more enemy kinds** ([ADR-0014](../architecture/adr/0014-mvp-scope.md)).
- Initiative, turns/rounds, attack and damage rolls, HP tracking.
- Conditions, concentration, durations etc. → [combat-extras](post-mvp/combat-extras.md).

## 2. Scope

- **Encounter builder** (tier S): pick creatures and quantities through **one shared "add creature" interface**, identical whatever the source (SRD/imported, custom, duplicated NPC, fixture). An SRD goblin and a custom Elite Goblin Warrior are treated the same. The encounter only knows "a creature definition", never where it came from; party = campaign characters; shows XP budget and difficulty (easy / medium / hard / deadly) per 2014 DMG.
- Encounters are saved and prepared before the session. **Encounter lifecycle: planned → started → ended** (DM clicks Start / End encounter). Stats and the game log are grouped per encounter. No session tracking ([ADR-0013](../architecture/adr/0013-session-journal-scope.md)).
- Start combat: PCs + the encounter's monsters (several kinds, N of each).
- **DM undo** (strict LIFO, one step at a time) of combat log entries, e.g. "Player X did 4 damage to creature Y" (damage/healing applied), via [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md).
- Initiative: roll (click-to-roll) or enter; **roll for all monsters in one click**; sorted order; ties.
- Rounds and turns: next/previous turn.
- Whose turn it is: shown in the initiative strip / portrait row. Token highlight on map only if trivial (tier B).
- **Attack flow (Shieldmaiden-style), DM confirms everything:**
  1. Select a target, click attack (**Shift = advantage, Ctrl = disadvantage**). Rolls automated or manual ([dice-roll-log](dice-roll-log.md)).
  2. **Attack popup** (DM): attack roll + modifier, **hit/miss computed vs target AC**, damage roll.
  3. DM adjusts: normal / half / none / double, **manual input to fudge any value** (attack total, hit/miss, damage).
  4. DM confirms → applied to HP and written to the **game log** BG2-style ("Goblin attacks Mira: 12 + 4 = 16 — hit! 6 damage"); visibility per category settings (player rolls always public).
  - Player attacks arrive as **damage cards** that open the same popup for the DM.
- **Damage cards** (a [notification](notifications.md) kind with an apply action, [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)): the attack result appears as a pending card for the DM. DM picks target and applies as normal / half (resistant) / none (immune) / double (vulnerable), **and can manually override any value** before applying (same attack popup as DM attacks). DM can also create cards.
- Healing: apply to HP; down at 0.
- Remove/defeat combatant; end encounter.
- **Custom creature form** (Shieldmaiden-style) + duplicate an existing creature ([OQ-CBT-16](#15-open-questions)).
- Player initiative view; **monster HP shown to players as a health band** (healthy / bloodied / down).
- Combatants bind to tokens the DM **already placed** on the battlemap (some hidden). Starting an encounter does not place tokens ([scenes-map](scenes-map.md)).
- **Capture combat facts for stats** from day one: every applied damage/heal records source, target, attack/weapon, raw roll, modifier, override, applied amount, target HP before/after, overkill ([stats](post-mvp/stats.md), [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)).

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

- Conditions, concentration, durations, temp HP, death saves, reinforcements (→ [combat-extras](post-mvp/combat-extras.md); tiers in [feature tiers](../feature-tiers.md#2-combat)).
- Player-ready / load indicator (→ [scene-tools](post-mvp/scene-tools.md)); MVP assumes immediate load.
- Rules automation (auto-hit vs AC, auto-apply damage). Hit/miss hint is tier B.
- Full monster stat block view on token click (tier B, [compendium](post-mvp/compendium.md)).
- Stats UI, end-of-combat summary (→ [stats](post-mvp/stats.md)); only the data capture is MVP.

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-CBT-NN.

## 7. UI/UX notes

> TODO (spec phase): DM combat panel; player initiative strip. Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): combat (round, current turn), combatant (entity ref, token ref, initiative, HP).

## 9. API & events

> TODO (spec phase). Visibility rule per event (monster HP to players).

## 10. Permissions

> TODO (spec phase): who may roll initiative / apply damage for a PC.

## 11. Edge cases & failure modes

> TODO (spec phase): crash mid-turn (must resume), combatant removed mid-round, token deleted, DM disconnect.

## 12. Performance & bandwidth

> TODO (spec phase).

## 13. Test plan

> TODO (spec phase): fixtures `player-1`, `enemy-1`, `battlemap` scene; crash-resume integration test; seeded dice. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [entities](entities.md) | Monster basics, character ref | open |
| [character-sheet](character-sheet.md) | PC AC/HP/init/attack | open |
| [dice-roll-log](dice-roll-log.md) | Initiative, attack, damage rolls | open |
| [live-sync](live-sync.md) | Events, visibility | open |
| [scenes-map](scenes-map.md) | Token ↔ combatant binding | open |
| [notifications](notifications.md) | Notification + action shape for damage cards | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CBT-02 | Health band thresholds | **Healthy > 50%, bloodied ≤ 50%, down = 0** / custom bands | no | live-sync |
| OQ-CBT-03 | PC HP source of truth | See [OQ-CHAR-02](character-sheet.md#15-open-questions) | yes | character-sheet |
| OQ-CBT-04 | Who applies damage? | **DM applies to anyone; player may apply to own PC** / DM only | no | character-sheet |
| OQ-CBT-05 | One-click monster initiative: one shared roll for the group, or individual rolls? | **Individual rolls, one click** / one shared roll | no | — |
| OQ-CBT-07 | Who picks the damage card target? | **Player picks (click token); DM confirms on apply** / DM only | yes | scenes-map |
| OQ-CBT-09 | Do unapplied cards persist across turn end? (crash-safe regardless, [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)) | **Yes, until applied or dismissed** / expire at turn end | no | notifications |
| OQ-CBT-06 | ~~Does combat start auto-create tokens?~~ **Decided: no; DM pre-places tokens, some hidden** | — | — | — |
| OQ-CBT-10 | Overkill: record against raw damage or capped at HP? | **Record both (applied = capped, overkill = raw − HP before)** / capped only | yes | post-mvp/stats |
| OQ-CBT-12 | CR math | **2014 DMG: XP by CR, party thresholds by level, group-size multiplier** / simplified CR sum | yes | entities, character-sheet |
| OQ-CBT-14 | Party for difficulty: all campaign characters or selected? | **Selected (defaults to all)** / all | no | — |
| OQ-CBT-15 | ~~Creature picker contents~~ **Decided: all creature definitions in the campaign, one list regardless of source.** Search only if near-free in MVP; otherwise tier A | — | — | — |
| OQ-CBT-16 | ~~Custom creature in MVP~~ **Decided: custom creature form, modelled on Shieldmaiden's** ([repo](https://github.com/HarmlessKey/Shieldmaiden); UX reference — check its licence before reusing code). Spec agent defines the MVP field subset; duplicate existing creature included | — | — | — |
| OQ-CBT-11 | Can players also use modifier keys / manual entry for their attack? | **Yes, same flow as DM** / DM only | no | dice-roll-log |

## 16. Out of scope

- See §4 Non-goals.
