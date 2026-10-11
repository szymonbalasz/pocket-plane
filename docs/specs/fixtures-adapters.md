---
title: Fixtures and source adapters
prefix: FIX
status: unclaimed
owner: —
wave: 1
---

# Fixtures and source adapters

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Tear down and rebuild any dev/test setup from fixtures, fast ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)).
- One adapter pipeline that later imports reference material from many sources (Open5e, 5etools JSON, homebrew, Obsidian).
- Whether fixtures go through the same pipeline is proposed in [ADR-0015](../architecture/adr/0015-source-adapters-fixtures.md).
- Fixtures power the agent build loop: load → test in a browser → discard ([ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)).

## 2. Scope

- Fixture set for the MVP session simulation ([ADR-0014](../architecture/adr/0014-mvp-scope.md)):
  - campaign + DM secret + one player with a stable player link
  - `player-1`: one character (basics: AC, HP, init, shortsword 1d6)
  - `enemy-1`, `enemy-2`: two SRD monster kinds, e.g. goblin and wolf (basics: AC, HP, init, one attack, CR/XP)
  - `enemy-custom`: Elite Goblin Warrior, derived from goblin (exercises the uniform creature interface)
  - items: shortsword (stock)
  - an encounter mixing both kinds for the party
  - `town` scene: simple shapes on white, grid, tokens (shapes on round circles)
  - `battlemap` scene: simple shapes on white, grid, tokens incl. hidden ones
- Composition: small fixtures combined into named bundles (e.g. `session-sim`).
- Commands: reset (empty DB + asset dir), load bundle, reset-and-load.
- Adapter interface usable by fixtures now and external sources later.
- Provenance recorded on everything loaded (source, version).
- Idempotent re-load (stable IDs).

## 3. Goals

> TODO (spec phase): e.g. empty → playable `session-sim` in one command, under N seconds.

## 4. Non-goals

- Open5e / 5etools adapters themselves (→ [compendium](post-mvp/compendium.md), [compendium-expansion](post-mvp/compendium-expansion.md)).
- Obsidian adapter (→ [obsidian-importer](post-mvp/obsidian-importer.md)).
- In-app import UI.

## 5. User stories

> TODO (spec phase): DM ("reset to a fresh session before game night"), spec/build agent ("spin up my worktree with the combat fixture").

## 6. Functional requirements

> TODO (spec phase): FR-FIX-NN.

## 7. UI/UX notes

> TODO (spec phase): CLI only in MVP? Or a DM "reset to fixture" button in dev mode? Per [visual-direction](../design/visual-direction.md) if any UI.

## 8. Data model

> TODO (spec phase): source/provenance record; fixture file format. Depends on [ADR-0015](../architecture/adr/0015-source-adapters-fixtures.md) and [ADR-0009](../architecture/adr/0009-entity-content-model.md).

## 9. API & events

> TODO (spec phase): adapter interface (stages, inputs, outputs, errors). Whether a running server must emit events / force resnapshot after a load.

## 10. Permissions

> TODO (spec phase): DM/dev only; never reachable by player client.

## 11. Edge cases & failure modes

> TODO (spec phase): partial load (transaction?), load while clients connected, fixture schema drift after model changes, missing fixture image.

## 12. Performance & bandwidth

> TODO (spec phase): load time budget so tests can reset per test/suite.

## 13. Test plan

> TODO (spec phase): every fixture loads cleanly into a fresh temp DB; re-load is idempotent; bundles compose; reset+load within budget. Browser walkthrough: load `session-sim`, open DM and player contexts, see town scene. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [ADR-0015](../architecture/adr/0015-source-adapters-fixtures.md) | Pipeline shape | proposed |
| [ADR-0009](../architecture/adr/0009-entity-content-model.md) | What a character/monster looks like | proposed |
| [campaign-management](campaign-management.md) | Campaign, player, link shape | open |
| [assets-pipeline](assets-pipeline.md) | Ingest fixture images | open |
| [entities](entities.md), [character-sheet](character-sheet.md), [scenes-map](scenes-map.md), [combat-tracker](combat-tracker.md) | Their records' shapes (fixtures follow them) | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-FIX-01 | Fixtures through the adapter pipeline? | See [ADR-0015](../architecture/adr/0015-source-adapters-fixtures.md) — **yes** | yes | all specs |
| OQ-FIX-02 | Fixture format | **TypeScript modules exporting zod-validated objects** / JSON files + schema / YAML | yes | all specs |
| OQ-FIX-03 | Fixture location and ownership | **One `fixtures/` tree; each feature spec names the fixtures it adds** / per-feature folders | no | all specs |
| OQ-FIX-04 | Mid-combat fixtures (e.g. "round 2, enemy at half HP")? | **Yes, as bundles layered on `session-sim`** / base state only | no | combat-tracker, live-sync |
| OQ-FIX-05 | ~~Fixture images~~ **Decided: simple shapes on white (maps), shapes on circles (tokens); tiny committed files or deterministic generation** ([ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)) | — | — | — |
| OQ-FIX-06 | Can the DM use fixtures in real play (e.g. "load my party")? | **Yes — same mechanism as homebrew sources later** / dev/test only | no | post-mvp/compendium |

## 16. Out of scope

- See §4 Non-goals.
