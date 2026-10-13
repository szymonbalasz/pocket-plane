# NNNN — Short UI notification sounds

- Status: proposed
- Date: 2026-10-13
- Amends: [ADR-0007](0007-product-scope.md) (exclusion "Audio")
- Raised by: DM feedback F1 ([feedback-phase3](../../agents/feedback-phase3.md)): a player's turn alert with a sound

## Context

- ADR-0007 excludes audio, meant as music, ambience and soundboards.
- The DM wants a short sound (default: a ping) plus a screen flash when it is a player's turn, and later to add his own sounds.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Allow short UI notification sounds only** (turn alert; later other alerts). Built-in default ping; DM-added sounds as audio assets (tier A). Per-client mute and volume in browser storage. Still excluded: music, ambience, soundboard, voice | Meets the request; small, bounded | Assets pipeline later accepts a few audio formats |
| B. Flash only, no sound | No ADR change | Doesn't meet the request |

## Decision

> Undecided. Suggested: **A**.

## Consequences

- ADR-0007 "Audio" row reads "Audio except short UI notification sounds (ADR-NNNN)".
- feature-tiers: turn alert flash + default ping tier S; DM-added sounds tier A (assets-pipeline accepts small audio files then).
- Browsers block autoplay until the user has interacted with the page; the player client unlocks audio on the first click (e.g. joining) and falls back to flash only.
