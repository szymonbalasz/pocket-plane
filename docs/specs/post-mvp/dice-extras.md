---
title: Dice extras
prefix: DICEX
status: in-review
owner: spec-tt
phase: post-mvp-8
---

# Dice extras (post-MVP stub)

> **[dice-extras](../dice-extras.md) (prefix DICEX) is the source of truth.** Sprint 3 took 3D dice, the tray, clickable notation and dice looks ([#203](../../decisions-log.md)); **sprint 8 took saved macros and DM roll requests** ([#334](../../decisions-log.md); FR-DICEX-64–72 and FR-DICEX-73–93). This stub keeps only what stays post-MVP: **player whispers** (tier C).

Ranking in [feature tiers](../../feature-tiers.md#3-character-sheet-and-dice).

| Tier | Feature | Where now |
|---|---|---|
| S | 3D dice roller | [dice-extras](../dice-extras.md) (sprints 3–5) |
| A | Clickable dice notation in free text | [dice-extras](../dice-extras.md) FR-DICEX-28–31 |
| A | Saved roll macros / custom roll buttons | [dice-extras](../dice-extras.md) FR-DICEX-64–72 (sprint 8) |
| B | DM requests a roll from players | [dice-extras](../dice-extras.md) FR-DICEX-73–93 (sprint 8; a notification with a roll action, [notifications](../notifications.md) FR-NOTE-58) |
| — | ~~Hidden DM rolls~~ | MVP: per-category public log settings ([dice-roll-log](../dice-roll-log.md)) |
| **C** | **Player whispers a roll to the DM** | **here (post-MVP)** |

- **Builds on:** a hidden request answer already reaches only the DM and the roller (`public: false` + `audiencePlayerId`, [FR-DICE-79](../dice-roll-log.md#6-functional-requirements)); a whisper would be the same audience chosen by the player on a free roll, and amends #73 ("player rolls are always public") the way the [roll-request ADR](../../architecture/adr/proposed-s8-tt-roll-requests.md) does for answers.
- **Carried-over open question** (suggested pick in bold; not for sprint 8):

| Question | Options |
|---|---|
| Whisper directions | **Player→DM and DM→player only** / any |

- Retired from this stub: "3D dice: cosmetic only, result server-side?" (decided #207: the animation plays the server's result, [ADR-0044](../../architecture/adr/0044-3d-dice.md)).
