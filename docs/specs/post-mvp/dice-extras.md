---
title: Dice extras
prefix: DICEX
status: stub
owner: —
phase: post-mvp
---

# Dice extras (post-MVP stub)

Beyond MVP [dice-roll-log](../dice-roll-log.md). Ranking in [feature tiers](../../feature-tiers.md#3-character-sheet-and-dice).

| Tier | Feature |
|---|---|
| A | Inline rolls in text (`[[1d20+5]]`) |
| A | Saved roll macros / custom roll buttons |
| A | 3D dice animation (Dice So Nice style) |
| B | DM requests a roll from players ("everyone roll Perception") — fits as a [notification](../notifications.md) with a roll action |
| B | Hidden DM rolls (players see "DM rolled") |
| C | Player whispers a roll to the DM |

- **Builds on:** [dice-roll-log](../dice-roll-log.md), [notifications](../notifications.md), [live-sync](../live-sync.md) (visibility filter for hidden/whispered rolls).
- **Carried-over open questions** (suggested pick in bold):

| Question | Options |
|---|---|
| DM broadcast controls | **DM rolls hidden by default, reveal per roll** / global toggle |
| Whisper directions | **Player→DM and DM→player only** / any |
| 3D dice: cosmetic only, result still server-side? | **Yes, animation plays server result** / client-rolled |

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP.
