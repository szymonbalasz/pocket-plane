---
title: Combat extras
prefix: CBTX
status: stub
owner: —
phase: post-mvp
---

# Combat extras (post-MVP stub)

Moved out of MVP by [ADR-0014](../../architecture/adr/0014-mvp-scope.md). (Encounter builder moved back into MVP: [combat-tracker](../combat-tracker.md).) Ranking in [feature tiers](../../feature-tiers.md#2-combat).

- **What:**

| Tier | Feature |
|---|---|
| A | Conditions (5e list) with expiry |
| A | Concentration tracking + save reminder on damage (notification with action) |
| A | Round-based effect durations ("Bless: 8 rounds") |
| A | Temp HP |
| A | Death saves |
| A | Add combatants mid-fight (reinforcements) |
| A | Hidden combatants (e.g. stealthed) — invisible to players until revealed |
| B | Drag to reorder initiative (delay/ready) |
| B | Hit/miss hint vs target AC |
| C | Legendary / lair action tracker |
| C | Reaction-used tracker |

- **Builds on:** [combat-tracker](../combat-tracker.md), [notifications](../notifications.md), [ADR-0016](../../architecture/adr/0016-domain-events-pending-actions.md) (durations/concentration as listeners), [compendium](compendium.md), [character-sheet-full](character-sheet-full.md).
- **Carried-over open questions** (suggested pick in bold):

| Question | Options |
|---|---|
| Concentration on damage | **Reminder with DC, click-to-roll** / auto-roll |
| Multiple simultaneous combats | **One per campaign** / many |
| Session tagging of combats | See [ADR-0013](../../architecture/adr/0013-session-journal-scope.md) |

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP.
