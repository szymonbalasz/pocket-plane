# Decisions log

Append-only. One line per decision. Written by the integrator at merge ([process](process.md#roles)).

## Kickoff

| # | Decision | Rationale | ADR |
|---|---|---|---|
| 1 | Runtime is Bun | Fast startup and tests; one tool for run/test/bundle | [0001](architecture/adr/0001-tech-stack.md) |
| 2 | Server is Hono: RPC for CRUD, native WebSocket for live events | Typed client from server routes; lightweight | [0001](architecture/adr/0001-tech-stack.md) |
| 3 | Client is Vite + React + Zustand + Tailwind + shadcn/ui | Mainstream, fast dev loop, minimal styling effort | [0001](architecture/adr/0001-tech-stack.md) |
| 4 | Map canvas is react-konva | React-friendly 2D canvas with layers and hit-testing | [0001](architecture/adr/0001-tech-stack.md) |
| 5 | DB is SQLite via Drizzle (`push` in dev, `generate` at release) | Single file, local hosting, typed schema, fast iteration | [0001](architecture/adr/0001-tech-stack.md) |
| 6 | zod at all boundaries | One validation layer shared by client and server | [0001](architecture/adr/0001-tech-stack.md) |
| 7 | Dice via `@dice-roller/rpg-dice-roller` | Mature notation support; no custom parser | [0001](architecture/adr/0001-tech-stack.md) |
| 8 | Images via `sharp` | Fast derivative generation | [0001](architecture/adr/0001-tech-stack.md) |
| 9 | Tests: `bun test` unit/integration, thin Playwright E2E | Fast default; E2E only for critical flows | [0001](architecture/adr/0001-tech-stack.md) |
| 10 | Single package, path aliases, no workspaces | Less tooling overhead for a one-table app | [0002](architecture/adr/0002-single-package.md) |
| 11 | Hosted on DM's machine at game time, via cloudflared tunnel | No cloud cost; only needed during sessions | [0003](architecture/adr/0003-local-hosting.md) |
| 12 | Campaign is the top-level scope; every record belongs to one | Simple tenancy; clean isolation between campaigns | [0004](architecture/adr/0004-tenancy-auth-permissions.md) |
| 13 | No user accounts; DM secret + per-player links bound to a name | Known group; accounts are overhead | [0004](architecture/adr/0004-tenancy-auth-permissions.md) |
| 14 | Permissions via two clients + minimal server ownership checks; no ACL | Only two roles exist; ACL framework is overkill | [0004](architecture/adr/0004-tenancy-auth-permissions.md) |
| 15 | Server-authoritative: intents → validate → mutate → broadcast per-record events | One source of truth; simple conflict model | [0005](architecture/adr/0005-server-authoritative-sync.md) |
| 16 | Events pass a visibility filter (DM all; players filtered) | Secrets never reach player clients | [0005](architecture/adr/0005-server-authoritative-sync.md) |
| 17 | Reconnect = request snapshot | Simpler than event replay | [0005](architecture/adr/0005-server-authoritative-sync.md) |
| 18 | Relational SQLite; JSON columns only for document-shaped leaf data | Queryable, migratable; avoid blob state | [0006](architecture/adr/0006-persistence.md) |
| 19 | Runtime session state lives in DB and survives crashes | Crash mid-session must not lose the table | [0006](architecture/adr/0006-persistence.md) |
| 20 | Laptops only; no touch/mobile | Known users, known devices | [0007](architecture/adr/0007-product-scope.md) |
| 21 | No dynamic lighting, freehand drawing, audio or extensions | Scope control; AoE props cover the drawing need | [0007](architecture/adr/0007-product-scope.md) |
| 22 | Full 5e character sheet from the start | Players need a complete sheet to replace existing tools | [0007](architecture/adr/0007-product-scope.md) |
| 23 | System is D&D 5e 2014 SRD; Open5e import first, 5etools JSON later | Table's system; SRD licence is clear | [0007](architecture/adr/0007-product-scope.md) |
| 24 | Parallel worktree dev: env-driven ports/paths, fixtures, no shared state | Many agents must run and test concurrently | [0008](architecture/adr/0008-parallel-dev-isolation.md) |
| 25 | Obsidian vault not ported; retired gradually | Migration cost outweighs value; optional importer later | [0007](architecture/adr/0007-product-scope.md) |
| 26 | MVP visuals: dark only, shadcn defaults; BG2-style theme post-MVP | Function first; theme later without rework | [visual-direction](design/visual-direction.md) |
| 27 | ADRs grouped one per decision area, not one per bullet | Fewer, more skimmable ADRs | — |
| 28 | Cross-cutting features (live sync, assets) written as normal specs, first wave | One template for all; ordering via roadmap | [roadmap](roadmap.md) |
| 29 | Claim status lives in spec front matter, not a shared table | Avoids merge conflicts between worktrees | [AGENTS.md](../AGENTS.md#4-claiming-a-feature) |
