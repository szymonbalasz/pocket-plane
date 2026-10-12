# 0017 — Agent-driven verification and fixture library

- Status: accepted
- Date: 2026-10-11
- Affects: all specs (test plans), fixtures-adapters, build phase
- Extends: [ADR-0008](0008-parallel-dev-isolation.md). Related: [ADR-0015](0015-source-adapters-fixtures.md)

## Context

- Building agents should **test and iterate as they go**, not just write code and unit tests.
- That needs realistic data that can be loaded, used and thrown away in seconds, in any worktree.
- Much of the app is visual and multi-client (canvas, floating windows, DM vs player views). Unit tests alone won't catch most regressions.

## Decision

**Build loop (every feature)**
1. Reset the worktree's DB + asset dir and load a fixture bundle (one command).
2. Run the app on the worktree's own ports ([ADR-0008](0008-parallel-dev-isolation.md)).
3. **Drive it in a browser**: DM client and player client(s) in separate browser contexts (the "incognito laptop").
4. Verify by navigating and interacting, not only by reading code. Fix, repeat.
5. Teardown: discard DB + assets. Nothing persists between runs.

**Fixture library**
- A maintained, versioned **fixture folder** is a first-class part of the codebase, not a test afterthought.
- Fixtures are small units composed into named bundles (e.g. `session-sim`, `mid-combat`).
- **Setups are scripts of server commands** (create campaign → add player → upload map → place token → hide → start encounter). Same path as the UI; fixtures can't create states the app can't reach, and double as walkthrough steps.
- Reference creatures (SRD goblin, wolf) load through the minimal import pipeline core as source `fixture` ([ADR-0015](0015-source-adapters-fixtures.md)).
- Every feature that adds a record type adds fixtures for it, and a bundle that exercises it.

**Fixture content: simple and clear**

| Kind | Fixture style |
|---|---|
| Battlemaps | Simple shapes on a white background, grid-friendly dimensions |
| Tokens | Simple shapes on round circles, distinct colours, readable at a glance |
| Creatures | SRD monsters as written (e.g. goblin, wolf, ogre) |
| Custom creature | One obviously-derived variant (e.g. "Elite Goblin Warrior" from goblin) to exercise the uniform creature interface |
| Characters | Plain level-1 PCs with stock gear |
| Items | Stock standard (shortsword, longbow, potion of healing) |

- No copyrighted art or non-SRD text. SRD content carries its licence attribution.
- Images are tiny and committed, or generated deterministically. Both are fine; choose at build phase.

## Consequences

- Each spec's **Test plan** names: fixtures used/added, the bundle, and the browser walkthrough an agent performs (DM steps, player steps, expected result).
- Fixture load + reset must be fast enough to run per walkthrough. Budget is set in [fixtures-adapters](../../specs/fixtures-adapters.md).
- Browser tooling: Playwright ([ADR-0001](0001-tech-stack.md)) for scripted E2E; agent's interactive browser tooling chosen at build phase.
- Selectors/test IDs on interactive UI so agents and Playwright can drive it reliably.

- Fixture layout and commands: [AGENTS.md §9.3](../../../AGENTS.md#93-fixtures). Browser tooling (Playwright MCP): [§9.6](../../../AGENTS.md#96-browser-verification-test-agents).
