# Spec index

Front matter in each spec is the source of truth. This table is refreshed by the integrator at merge — don't edit it from a feature worktree ([AGENTS.md §4](../../AGENTS.md#4-claiming-a-feature)).

Template: [_template.md](_template.md). Specs are written just in time, per build phase: [roadmap](../roadmap.md#build-order-mvp). MVP definition: [ADR-0014](../architecture/adr/0014-mvp-scope.md).

## MVP

| Build phase | Spec | Prefix | Status | Owner |
|---|---|---|---|---|
| 1. Foundation | [Live sync, reconnect, visibility](live-sync.md) | SYNC | complete | spec-live-sync |
| 1. Foundation | [Campaign management](campaign-management.md) | CAMP | complete | spec-campaign-management |
| 1. Foundation | [Fixtures and import pipeline core](fixtures-adapters.md) | FIX | complete | spec-fixtures-adapters |
| 2. Scenes | [Assets pipeline](assets-pipeline.md) | ASSET | complete | spec-assets-pipeline |
| 2. Scenes | [Entities (core)](entities.md) | ENT | complete | spec-entities |
| 2. Scenes | [Play shell](play-shell.md) | SHELL | complete | spec-play-shell |
| 2. Scenes | [Scenes and map](scenes-map.md) | MAP | complete | spec-scenes-map |
| 3. Combat | [Character sheet (basics)](character-sheet.md) | CHAR | complete | spec-character-sheet |
| 3. Combat | [Dice and game log](dice-roll-log.md) | DICE | complete | spec-dice-roll-log |
| 3. Combat | [Notifications](notifications.md) | NOTE | complete | spec-notifications |
| 3. Combat | [Combat tracker](combat-tracker.md) | CBT | complete | spec-combat-tracker |
| 4. Reward + hardening | [Party loot](party-loot.md) | LOOT | complete | spec-party-loot |

## Sprint 1 (post-MVP)

| Spec | Prefix | Status | Owner |
|---|---|---|---|
| [Combat extras](combat-extras.md) | CBTX | complete | spec-combat-extras |
| [Character sheet (full)](character-sheet-full.md) | CHARX | complete | spec-character-sheet-full |

Sprint 1 also revised scenes-map, play-shell, combat-tracker, dice-roll-log and notifications (polish R1–R5, #178).

## Sprint 2 (post-MVP)

| Spec | Prefix | Status | Owner |
|---|---|---|---|
| [Effect modifiers](effect-modifiers.md) | MOD | complete | spec-effect-modifiers |

Sprint 2 phase 1 also revised combat-tracker, combat-extras, entities, notifications (P2a) and play-shell, scenes-map, character-sheet, character-sheet-full, campaign-management, dice-roll-log (P2b) for the DM's playtest notes N1–N11 and glitches G1–G10 (#190).

## Post-MVP

Stubs only. Not to be claimed during MVP spec phase.

| Spec | Prefix | Note |
|---|---|---|
| [Compendium](post-mvp/compendium.md) | CMP | First candidate after MVP |
| [World builder](post-mvp/world-builder.md) | WORLD | Incl. location ↔ scenes |
| [Scene tools](post-mvp/scene-tools.md) | SCN | Fog, hidden tokens, AoE props |
| [Stats and summaries](post-mvp/stats.md) | STATS | Data capture starts in MVP |
| [Dice extras](post-mvp/dice-extras.md) | DICEX | Inline rolls, macros, 3D dice, hidden rolls |
| [Gems (homebrew)](post-mvp/gems.md) | GEM | DM-awarded gems; reroll, max damage dice; tier A |
| [Party board](post-mvp/party-board.md) | PARTY | |
| [Campaign manager](post-mvp/campaign-manager.md) | CMGR | |
| [Compendium expansion](post-mvp/compendium-expansion.md) | CMPX | |
| [Levelling workflows](post-mvp/levelling.md) | LVL | |
| [Agent / MCP API](post-mvp/agent-api.md) | AGENT | |
| [Theme system](post-mvp/theme-system.md) | THEME | |
| [Single executable](post-mvp/single-executable.md) | PKG | |
| [Obsidian importer](post-mvp/obsidian-importer.md) | OBS | |
