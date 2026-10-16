---
title: Dice extras
prefix: DICEX
status: stub
owner: —
phase: post-mvp
---

# Dice extras (post-MVP stub)

> **In scope for sprint 3 (DM decision [#203](../../decisions-log.md), 2026-10-16):** 3D dice, a dice tray, clickable dice notation in free text, and **dice customisation** (per-player dice look). **Expanded into [dice-extras](../dice-extras.md) (prefix DICEX); that spec is the source of truth.** This stub stays for the tier table and the items not taken into sprint 3 (macros, roll requests, whispers). A 3D / physics library is a new dependency (AGENTS §3: needs the DM's OK at gate 1).

Beyond MVP [dice-roll-log](../dice-roll-log.md). Ranking in [feature tiers](../../feature-tiers.md#3-character-sheet-and-dice).

| Tier | Feature |
|---|---|
| S | **3D dice roller** in a tray or over the battlemap; every roll in the app eventually goes through it; customisation later (B) (#188) |
| A | **Dice notation in any free text is clickable** ("1d12+5", whitespace-tolerant): puts the dice in the tray to adjust before rolling; doesn't feed attack / apply. Very important (#188) |
| A | Saved roll macros / custom roll buttons |
| B | DM requests a roll from players ("everyone roll Perception") — fits as a [notification](../notifications.md) with a roll action |
| — | ~~Hidden DM rolls~~ → MVP as per-category public log settings ([dice-roll-log](../dice-roll-log.md)) |
| C | Player whispers a roll to the DM |

- **Builds on:** [dice-roll-log](../dice-roll-log.md), [notifications](../notifications.md), [live-sync](../live-sync.md) (visibility filter for hidden/whispered rolls).
- **Carried-over open questions** (suggested pick in bold):

| Question | Options |
|---|---|
| Whisper directions | **Player→DM and DM→player only** / any |
| 3D dice: cosmetic only, result still server-side? | **Yes, animation plays server result** / client-rolled |

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP.
