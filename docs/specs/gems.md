---
title: Gems (homebrew)
prefix: GEM
status: claimed
owner: spec-gems
phase: post-mvp-7
---

# Gems (post-MVP stub)

The DM's homebrew reward rule ([decisions #140](../../decisions-log.md)). Tier **A**: first post-MVP iterations. The MVP specs shape their interfaces so gems fit without data changes ("design for later", below). Ranking in [feature tiers](../../feature-tiers.md#6-table-specific).

## Rules (as given by the DM)

- The DM awards gems to characters. **Max 5 held per character** — a loose table rule, **not enforced by code** (show the count; at most a soft hint).
- Spending a gem consumes it.

| Gem | Look | Effect | Awarded for |
|---|---|---|---|
| **Inspiration** | Translucent white, faint inner glow | Reroll any one d20 roll, even after seeing the result; must keep the new roll. Or: consume at any time to ask the DM to help recall an event, NPC, dialogue… | Heroism, dramatic character moments, apt skill use, clever roleplay |
| **Fortune** | Lustrous black, mirror-like | Search anywhere for "additional treasure"; the DM rolls a d100, outcome by location and narrative (a stream: an old copper or an ancient ring; a noble's desk: a scroll, a ring, or a wrapper) | Curiosity, creativity, exploration in non-obvious ways |
| **Combat** | Jagged crimson, pulsing | Turn one damage die to its maximum after rolling (level 6: two dice; level 12: three). One attack or spell only | Epic combat moments, brilliant tactics, turning the tide |
| **Divine Knowledge** | Deep amethyst, shifting patterns | Ask any question; a divine or cosmic force answers in an unexpected way | Deep lore, spiritual moments, clever insight, pleasing the DM |
| **Action** | Lightning-blue, crackling | In combat: gain 1 bonus action or 1 reaction; spend 2 gems for 1 full action instead. Can't upgrade a bonus action into a full action | Tactical creativity, fast thinking, cinematic manoeuvres |

## What the game needs

- Gem counts per character and kind, visible to the owner and the DM (others: open question).
- DM: award / remove gems. Player: spend a gem → a game-log line ("Mira spends a Combat gem").
- **Inspiration (reroll):** the player rerolls a d20 roll from the log; the new roll replaces the old one (old stays visible, struck through).
- **Combat (max dice):** before the DM applies a damage card, the player sets 1–3 of its damage dice to max; the card's total updates.
- Fortune, Divine Knowledge, Action: spend + log line only; the effect happens at the table.

## Design for later (MVP interfaces)

| MVP spec | Must allow |
|---|---|
| [dice-roll-log](../dice-roll-log.md) | Store **each die's result** (not only the total); a log entry can be **superseded** by a later roll (reroll link) |
| [combat-tracker](../combat-tracker.md) | A pending damage card's dice can be **modified before apply** (total recomputed server-side) |
| [character-sheet](../character-sheet.md) | Room for a per-character counter block (no MVP UI) |
| [notifications](../notifications.md) | None expected |

## Open questions

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-GEM-01 | Do other players see a character's gems? | **Yes, counts only (party flavour)** / owner + DM only | no | - |
| OQ-GEM-02 | Gem spends in the game log: always public? | **Yes** / follow a log category | no | dice-roll-log |
| OQ-GEM-03 | Gem art | **DM-supplied images via the asset pipeline** / built-in icons | no | assets-pipeline |

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP.
