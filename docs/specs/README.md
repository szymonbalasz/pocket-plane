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
| [Fog of war](fog-of-war.md) | FOG | complete | spec-fog-of-war |
| [Scene tools](scene-tools.md) | SCN | complete | spec-scene-tools |

Sprint 2 phase 1 also revised combat-tracker, combat-extras, entities, notifications (P2a) and play-shell, scenes-map, character-sheet, character-sheet-full, campaign-management, dice-roll-log (P2b) for the DM's playtest notes N1–N11 and glitches G1–G10 (#190).

## Sprint 3 (post-MVP)

| Spec | Prefix | Status | Owner |
|---|---|---|---|
| [Compendium](compendium.md) | CMP | complete | spec-compendium |
| [Dice extras](dice-extras.md) | DICEX | complete | spec-dice-extras |
| [Effect modifiers](effect-modifiers.md) (revision: tiers 2–3, rule triggers) | MOD | complete | spec-rule-triggers |
| [Party board](party-board.md) | PARTY | complete | spec-party-board |
| [Fog of war](fog-of-war.md) (v2: freeform fog, dynamic vision, Invisible) | FOG | complete | spec-vision |
| [Scene tools](scene-tools.md) (revision: freeform walls, sight, wall hint) | SCN | complete | spec-vision |
| [Character sheet full](character-sheet-full.md) (revision: senses) | CHARX | complete | spec-vision |

Sprint 3 also revised live-sync (lazy record types, FR-SYNC-30–38) and party-loot (item rows, split).

## Sprint 4 (post-MVP)

All revisions, gate 1 #245 (ADRs 0047–0050).

| Spec | Prefix | Status | Owner |
|---|---|---|---|
| [Fog of war](fog-of-war.md) (party vision, sight while dragging, 999 ft default, brush, Ctrl+Z) | FOG | complete | spec-vision |
| [Dice extras](dice-extras.md) (full-screen dice, roll popup, die-shape chips) | DICEX | complete | spec-dice |
| [Dice and game log](dice-roll-log.md) (dice in log lines) | DICE | complete | spec-dice |
| [Scene tools](scene-tools.md) (freeform AoE, coverage) | SCN | complete | spec-maptools |
| [Scenes and map](scenes-map.md) (pan, Fit, drag path, labels, Show to players) | MAP | complete | spec-maptools |
| [Play shell](play-shell.md) (window placement, launcher) | SHELL | complete | spec-maptools |
| [Effect modifiers](effect-modifiers.md) (effects review, trigger state, badges) | MOD | complete | spec-rules |
| [Combat tracker](combat-tracker.md) (weapon damage parts, BL-10 copy) | CBT | complete | spec-rules |
| [Combat extras](combat-extras.md) (badges, effect hooks) | CBTX | complete | spec-rules |
| [Character sheet full](character-sheet-full.md) (senses default, magic weapons, negative uses) | CHARX | complete | spec-rules |
| [Compendium](compendium.md) (word search, ranking, groups) | CMP | complete | spec-compendium |
| [Entities](entities.md) (creature type, token art) | ENT | complete | spec-compendium |

## Sprint 7 (post-MVP)

Gate 1 #315 (ADRs 0058, 0059).

| Spec | Prefix | Status | Owner |
|---|---|---|---|
| [Gems](gems.md) (optional per-campaign feature: award / spend, Inspiration reroll, Combat gem) | GEM | complete | spec-gems |
| [Stats](stats.md) (damage leaderboard, overkill callouts, session awards) | STATS | complete | spec-stats |

Sprint 7 also revised campaign-management (feature switch), dice-roll-log (reroll supersede, stats reads), combat-tracker (max dice, From on heals, kept HP on rebind, compact companion line, End dialog), character-sheet-full (gem block), play-shell (auto-minimise instead of covering PCs, useful sizes, Space, Stats window), scenes-map, combat-extras, notifications, entities, party-board, party-loot, dice-extras, effect-modifiers, compendium (sprint-6 follow-ups, BL-46, BL-48).

## Sprint 8 (post-MVP)

All revisions, gate 1 #335 (ADRs 0060–0063).

| Spec | Prefix | Status | Owner |
|---|---|---|---|
| [Play shell](play-shell.md) (one placer, useful sizes, replay harness, pause screen, alert sounds, Party status window) | SHELL | complete | spec-wf, spec-tt, spec-cb |
| [Scenes and map](scenes-map.md) (refits never zoom in, turn highlight) | MAP | complete | spec-wf, spec-cb |
| [Notifications](notifications.md) (one toast policy, roll-request prompt, fight summary) | NOTE | complete | spec-wf, spec-tt, spec-sb |
| [Dice extras](dice-extras.md) (macros, roll requests) | DICEX | complete | spec-tt |
| [Dice and game log](dice-roll-log.md) (request answers, luck reads) | DICE | complete | spec-tt, spec-sb |
| [Assets pipeline](assets-pipeline.md) (audio assets) | ASSET | complete | spec-tt |
| [Campaign management](campaign-management.md) (pause, alert sound picks) | CAMP | complete | spec-tt |
| [Stats](stats.md) (kill feed, luck tracker, trophies, fight summary) | STATS | complete | spec-sb, spec-wf |
| [Character sheet full](character-sheet-full.md) (Macros + Trophies tabs, companion card size) | CHARX | complete | spec-tt, spec-sb, spec-wf |
| [Combat tracker](combat-tracker.md) (tie order, End summary hook, `fell`) | CBT | complete | spec-cb, spec-sb |
| [Combat extras](combat-extras.md) (drag to reorder initiative) | CBTX | complete | spec-cb |
| [Party board](party-board.md) (Party status) | PARTY | complete | spec-cb |

## Sprint 9 (post-MVP)

Gate 1 #339 (ADRs 0064–0068).

| Spec | Prefix | Status | Owner |
|---|---|---|---|
| [Reminders](reminders.md) (party / character reminders with rolls, Party Manager tab, sheet tab) | REM | complete | spec-rs |
| [Strongholds](strongholds.md) (staff, facilities, defenders, Stores, Stronghold window) | HOLD | complete | spec-rs |
| [Session recap](session-recap.md) (on-demand recap, DM Share) | RECAP | complete | spec-sp |
| [Play shell](play-shell.md) (window memory, Party Manager, command palette + shortcuts, stale-chunk reload, Stronghold window) | SHELL | complete | spec-pm, spec-fx, spec-rs, spec-sp |
| [Party board](party-board.md) (Party Manager: Party status first, Companions section, 550 px; Reminders / Strongholds tabs) | PARTY | complete | spec-pm, spec-rs, spec-fx |
| [Scenes and map](scenes-map.md) (resize refits, BL-86 / -87) | MAP | complete | spec-pm |
| [Party loot](party-loot.md) (Stores holder) | LOOT | complete | spec-rs |
| [Character sheet full](character-sheet-full.md) (Reminders tab) | CHARX | complete | spec-rs |
| [Compendium](compendium.md) (rules quick reference, Rules window, house rules) | CMP | complete | spec-sp |
| [Stats](stats.md) (hidden-kill feed, query retry, recap reads) | STATS | complete | spec-fx, spec-sp |
| [Notifications](notifications.md) (toast stack column, Notifications window fold) | NOTE | complete | spec-fx |
| [Combat extras](combat-extras.md) (effects line export, summon concentration at End) | CBTX | complete | spec-rs, spec-fx |
| [Dice and game log](dice-roll-log.md), [Dice extras](dice-extras.md), [Gems](gems.md) (reroll line, keep-highest join, copy, popup expiry, macro name, gem batching, one spend frame) | DICE, DICEX, GEM | complete | spec-fx |
| [Live sync](live-sync.md) (drop detection), [Campaign management](campaign-management.md) (switcher ellipsis), [Fixtures and adapters](fixtures-adapters.md) (load clock) | SYNC, CAMP, FIX | complete | spec-fx |

## Art track (2026-10-25)

DM picks #351 (ADR-0069). Look: the Gilt & Stone kit page [gilt-stone.html](../design/art/kit/gilt-stone.html); art sources in [design/art](../design/art/README.md).

| Spec | Prefix | Status | Owner |
|---|---|---|---|
| [Theme system](post-mvp/theme-system.md) (Default + Gilt & Stone, per-browser switch in Preferences, bundled fonts) | THEME | complete | spec-theme-system |
| [Character sheet full](character-sheet-full.md) (printed sheet layout, both themes, FR-CHARX-105–120; OQ-CHARX-47–50 decided A, #352) | CHARX | complete | spec-charx-print-sheet |

## Post-MVP

Stubs only. Not to be claimed during MVP spec phase.

| Spec | Prefix | Note |
|---|---|---|
| [World builder](post-mvp/world-builder.md) | WORLD | Incl. location ↔ scenes |
| [Dice extras](post-mvp/dice-extras.md) | DICEX | Whispers only (the rest is in [dice-extras](dice-extras.md)) |
| [Campaign manager](post-mvp/campaign-manager.md) | CMGR | |
| [Compendium expansion](post-mvp/compendium-expansion.md) | CMPX | |
| [Levelling workflows](post-mvp/levelling.md) | LVL | |
| [Agent / MCP API](post-mvp/agent-api.md) | AGENT | |
| [Theme system](post-mvp/theme-system.md) | THEME | Expanded, see [Art track](#art-track-2026-10-25) |
| [Single executable](post-mvp/single-executable.md) | PKG | |
| [Obsidian importer](post-mvp/obsidian-importer.md) | OBS | |
