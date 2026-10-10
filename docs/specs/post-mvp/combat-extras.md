---
title: Combat extras
prefix: CBTX
status: stub
owner: —
phase: post-mvp
---

# Combat extras (post-MVP stub)

Moved out of MVP by [ADR-0014](../../architecture/adr/0014-mvp-scope.md).

- **What:** Encounter builder with CR/XP math, multiple enemy kinds, conditions, concentration, per-combatant hidden visibility, multiple attacks/actions per combatant.
- **Builds on:** [combat-tracker](../combat-tracker.md), [compendium](compendium.md), [character-sheet-full](character-sheet-full.md).
- **Carried-over open questions** (suggested pick in bold):

| Question | Options |
|---|---|
| CR/difficulty math | **2014 DMG XP thresholds + multiplier** / simplified |
| Concentration on damage | **Reminder with DC, click-to-roll** / auto-roll |
| Multiple simultaneous combats | **One per campaign** / many |
| Session tagging of combats | See [ADR-0013](../../architecture/adr/0013-session-journal-scope.md) |

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP.
