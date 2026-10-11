---
title: Stats and summaries
prefix: STATS
status: stub
owner: —
phase: post-mvp
---

# Stats and summaries (post-MVP stub)

The table loves this: who did the damage, overkill (100 dmg on a 20 HP monster), Baldur's Gate-style records.

- **What:**
  - End-of-combat summary: damage dealt / taken / healed per combatant, XP *(tier B)*.
  - Campaign-wide stats per character: totals, records, fun facts. Shown on the character.
  - Examples: most damage in a single attack, biggest overkill, toughest monster killed, kills, nat 20s / nat 1s, favourite weapon, total healing, times downed.
- **MVP impact (now):** capture facts from day one so stats can be computed retroactively. See [combat-tracker](../combat-tracker.md#2-scope) (damage/heal facts) and [dice-roll-log](../dice-roll-log.md) (every roll persisted). Event log question in [ADR-0016](../../architecture/adr/0016-domain-events-pending-actions.md).
- **Builds on:** [combat-tracker](../combat-tracker.md), [dice-roll-log](../dice-roll-log.md), [character-sheet](../character-sheet.md), [ADR-0013](../../architecture/adr/0013-session-journal-scope.md) (per-session stats).
- **Open:**
  - Which stats are public vs per-player vs DM-only?
  - Computed on read from facts, or materialised counters?
  - Does manual override of damage count as "dealt"? (Probably applied amount, with raw kept for overkill.)

> TODO (spec phase): discuss after MVP, expand from [_template.md](../_template.md).
