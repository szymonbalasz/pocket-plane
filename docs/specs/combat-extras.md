---
title: Combat extras
prefix: CBTX
status: claimed
owner: spec-combat-extras
phase: post-mvp-1
---

# Combat extras (post-MVP stub)

Moved out of MVP by [ADR-0014](../architecture/adr/0014-mvp-scope.md). (Encounter builder moved back into MVP: [combat-tracker](combat-tracker.md).) Ranking in [feature tiers](../feature-tiers.md#2-combat).

- **What:**

| Tier | Feature |
|---|---|
| A | Conditions (5e list) with expiry |
| A | Concentration tracking + save reminder on damage (notification with action) |
| A | Round-based effect durations ("Bless: 8 rounds") |
| A | Temp HP |
| A | Death saves |
| A | Add combatants mid-fight (reinforcements) |
| S | ~~Hidden combatants~~ → **MVP** via the token hide button ([scenes-map](scenes-map.md)) |
| A | **Custom monster/NPC actions** that auto-roll against the selected target(s) |
| A | **Multi-target select** (e.g. one action vs several targets, AoE saves) |
| B | Drag to reorder initiative (delay/ready) |
| C | Legendary / lair action tracker |
| C | Reaction-used tracker |

- **Builds on:** [combat-tracker](combat-tracker.md), [notifications](notifications.md), [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md) (durations/concentration as listeners), [compendium](post-mvp/compendium.md), [character-sheet-full](post-mvp/character-sheet-full.md).
- **Carried-over open questions** (suggested pick in bold):

| Question | Options |
|---|---|
| Concentration on damage | **Reminder with DC, click-to-roll** / auto-roll |
| Multiple simultaneous combats | **One per campaign** / many |
| Session tagging of combats | See [ADR-0013](../architecture/adr/0013-session-journal-scope.md) |

> TODO (spec phase): expand from [_template.md](_template.md) after MVP.
