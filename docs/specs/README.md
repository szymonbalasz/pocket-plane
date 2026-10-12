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
| 4. Reward + hardening | [Party loot](party-loot.md) | LOOT | unclaimed | — |

## Post-MVP

Stubs only. Not to be claimed during MVP spec phase.

| Spec | Prefix | Note |
|---|---|---|
| [Compendium](post-mvp/compendium.md) | CMP | First candidate after MVP |
| [World builder](post-mvp/world-builder.md) | WORLD | Incl. location ↔ scenes |
| [Scene tools](post-mvp/scene-tools.md) | SCN | Fog, hidden tokens, AoE props |
| [Character sheet (full)](post-mvp/character-sheet-full.md) | CHARX | |
| [Combat extras](post-mvp/combat-extras.md) | CBTX | Conditions, concentration, durations, hidden combatants… |
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
