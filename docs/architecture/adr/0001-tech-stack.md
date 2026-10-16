# 0001 — Tech stack

- Status: accepted
- Date: 2026-10-10
- Affects: all specs

## Context

- Need a fast dev loop for many parallel agents, one deployable process, typed end to end.

## Decision

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun | Runs server, tests, scripts |
| Server | Hono | REST via **Hono RPC** for CRUD; **native WebSocket** for live events |
| Client | Vite + React | Two entry points: DM and player ([ADR-0004](0004-tenancy-auth-permissions.md)) |
| Client state | Zustand | |
| Styling | Tailwind + shadcn/ui | Per [visual-direction](../../design/visual-direction.md) |
| Map canvas | react-konva | |
| DB | SQLite via Drizzle ORM | `drizzle-kit push` in dev; `drizzle-kit generate` migrations at release |
| Validation | zod | At all boundaries: HTTP, WS, DB JSON columns, imports |
| Dice | ~~`@dice-roller/rpg-dice-roller`~~ → own roller over the dice-roll-log grammar + `random-js` (#151) | Evaluated server-side. The library pulled in mathjs (~9 s import on Windows) |
| 3D dice | `three` + `cannon-es` (#207, [ADR-0044](0044-3d-dice.md)) | Client only, lazy chunk; cosmetic throws that settle on the server's result |
| Images | `sharp` | Derivatives for assets |
| Tests | `bun test` (unit/integration); Playwright (thin E2E) | E2E only for critical flows |

## Consequences

- Specs may assume these libraries; don't propose alternatives without a superseding ADR.
- WS message schemas are zod, shared by server and both clients.
- Dice results are server-authoritative (no client-side rolling that counts).
