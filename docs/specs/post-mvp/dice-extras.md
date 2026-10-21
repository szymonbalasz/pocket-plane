---
title: Dice extras
prefix: DICEX
status: in-review
owner: spec-tt
phase: post-mvp-8
---

# Dice extras (post-MVP stub)

> **[dice-extras](../dice-extras.md) is the source of truth.** Sprint 3 took 3D dice, tray, notation and looks (#203); sprint 8 took macros (FR-DICEX-64–72) and DM roll requests (FR-DICEX-73–93) (#334). Only **player whispers** (tier C) stay here.

| Tier | Feature | Where |
|---|---|---|
| S / A | 3D dice; clickable notation | [dice-extras](../dice-extras.md) |
| A / B | Saved macros; DM roll requests | [dice-extras](../dice-extras.md) (sprint 8) |
| **C** | **Player whispers a roll to the DM** | here |

- A whisper would reuse the hidden-answer audience (`public: false` + `audiencePlayerId`, [FR-DICE-79](../dice-roll-log.md#6-functional-requirements)) on a free roll. Open question for later: whisper directions, **player→DM and DM→player only** / any.
