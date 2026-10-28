# proposed — Agent MCP server: a local DM caller over stdio

- Status: proposed (spec-agent-api; DM track [#378](../../decisions-log.md))
- Date: 2026-10-28
- Amends: none. Builds on [ADR-0003](0003-local-hosting.md), [ADR-0004](0004-tenancy-auth-permissions.md), [ADR-0005](0005-server-authoritative-sync.md), [ADR-0006](0006-persistence.md), [ADR-0016](0016-domain-events-pending-actions.md), [ADR-0019](0019-auth-credentials.md), [ADR-0024](0024-definition-visibility.md)
- Affects: [agent-api](../../specs/agent-api.md); AGENTS §9.1 (new area), §9.4 (scripts); tooling `package.json`, `tsconfig.json`, `biome.json`, `src/boundaries.test.ts`

## Context

- #378: an MCP server lets the DM create and edit content from Claude Code. It is just another caller (server commands, event log, filter), it never touches SQLite, every tool refuses when the server isn't running, and nothing goes to the cloud.
- Existing pieces: DM secret in `.env` (`PP_DM_SECRET`, AGENTS §9.2); `$PP_DATA_DIR/server.lock` `{owner, pid, port, startedAt}` (`src/server/runtime/lock.ts`); DM REST `Authorization: Bearer`; WS `hello {role: "dm", secret}`; `parseConfig` is the only reader of `process.env`.
- Claude Code loads `.mcp.json` servers listed in `.claude/settings.json` `enabledMcpjsonServers` (today `pw-dm`, `pw-player-1`, `pw-player-2`). Test agents rely on that; builder agents shouldn't get content-writing tools.

## Options and decision

**D1. Transport**

| Option | Pros | Cons |
|---|---|---|
| **A. stdio process `bun run mcp`** | Claude Code's default; no port, nothing to expose; process dies with the session | One process per Claude Code session |
| B. Streamable HTTP route `/mcp` on Hono | No extra process | New server API; reachable through the tunnel; "server not running" becomes "MCP failed to connect" rather than a tool refusal |
| C. HTTP on its own local port | Shared across sessions | A port to allocate per worktree (ADR-0008) for no gain |

**Pick A.**

**D2. Auth**

| Option | Pros | Cons |
|---|---|---|
| **A. DM secret from `.env` via `parseConfig`** | Existing credential and checks (ADR-0019); no new storage | The agent has full DM power (intended: it's the DM's tool) |
| B. Scoped agent token | Narrower power | New credential, storage, routes and UI |
| C. No auth on loopback | Simple | Contradicts FR-CAMP-04 (no auth by source address) |

**Pick A.** Stop DM checks after the first rejection until restart, so a bad `.env` can't trip the throttle ([OQ-AGENT-06](../../specs/agent-api.md#15-open-questions)).

**D3. Finding the server and the profile**

| Option | Pros | Cons |
|---|---|---|
| **A. Read `server.lock` on every call: `owner: server`, PID alive, `port` set → `127.0.0.1:<port>`** | One truth, already written by `start` / `dev`; handles OS-assigned ports; refusal is exact | Read-only: a stale lock is left for the next `start` to clear |
| B. Compute the port from `PP_SLOT` + profile | No file read | Wrong for `PP_PORT` overrides and port 0; can't tell "not running" from "refused" |
| C. Explicit `PP_MCP_URL` | Flexible | Another env var to keep in sync |

**Pick A.** Profile = `parseConfig`'s (`PP_PROFILE`, or `--profile` in the registered command), so the MCP server resolves the same data dir as `bun run start` with the same `.env`. Always `127.0.0.1`, never the tunnel URL.

**D4. Server API**

| Option | Pros | Cons |
|---|---|---|
| **A. Reuse the existing REST routes + WS intents (`hello`, snapshot, `sync.load`, intents); no new server API** | Same validation, events, filter and tests as the DM client; zero server change | A few gaps need read-modify-write or client-side dry run (spec OQ-AGENT-03/04/07) |
| B. New `/api/agent/*` routes | Shapes tuned for agents | Second path to keep in step; new surface |
| C. Call commands in-process on the DB | Fast | Forbidden by #378 (2); bypasses the server's broadcast while it runs |

**Pick A.**

**D5. Code location**

| Option | Pros | Cons |
|---|---|---|
| **A. `src/mcp/`, alias `@mcp/*`** | Typed, linted, tested like the rest; clear boundary | New AGENTS §9.1 row |
| B. `scripts/mcp/` | No new alias | `scripts/` may import anything: no boundary, easy to reach into the DB |
| C. `src/server/features/agent-api/` | Near the code it calls | Looks like server code, but runs in a separate process |

**Pick A.** Rules:

| Rule | Detail |
|---|---|
| May import | `@shared/*`; `@server/config` (`parseConfig`); `@server/runtime/lock` (`readLock`, `isPidAlive`; not `liveLock`, which deletes); `import type { AppType } from "@server/app"` with `hono/client` (`hc`); the MCP SDK |
| Must not import | Any other `@server/*`, `@ui`, `@dm`, `@player`, `@fixtures`, `bun:sqlite`, `drizzle-*` |
| Imported by | Nothing but `scripts/mcp-call.ts` and its own tests |
| Enforced | `src/boundaries.test.ts` area `mcp` + Biome restricted imports |
| WS | A small client of its own on `@shared/protocol` frames (Bun's `WebSocket`); the browser client in `@ui` is not reused |
| Scripts | `package.json` `mcp` → `bun src/mcp/index.ts`; `mcp:call` → `bun scripts/mcp-call.ts` (spawns the stdio server, calls one tool, prints the result; exit ≠ 0 on error) |

**D6. Registering for Claude Code**

| Option | Pros | Cons |
|---|---|---|
| **A. DM-local registration in the DM's own checkout only: `claude mcp add --scope local pocket-plane -- bun run mcp`; nothing in `.mcp.json`** | Worktrees (builders, test agents) never see it; `.mcp.json` / `opencode.json` stay identical (AGENTS §9.6) | One documented setup step per machine |
| B. Entry in `.mcp.json`, not in committed `enabledMcpjsonServers`; DM enables it in `.claude/settings.local.json` | Discoverable in the repo | Test agents load `.mcp.json`, so they depend on the allow-list staying exact; `opencode.json` drifts or gains it too |
| C. Enabled in `.mcp.json` for all; builders start with `--strict-mcp-config` | One config | Test agents get write tools on their verify data; every new agent kind must remember the flag |

**Pick A.** Walkthroughs and e2e use `bun run mcp:call` (real stdio path) instead of a registered server. The skill (`.claude/skills/pocket-plane-content/`) is committed. It is visible in every worktree but inert without the tools, and its description limits it to DM content requests.

## Consequences

- No server change. The new code is a client of the existing API, so its tests reuse the in-process server harness (port 0, `:memory:`).
- Shared-file changes through the orchestrator: `package.json` (scripts, the SDK dependency if [OQ-AGENT-01](../../specs/agent-api.md#15-open-questions) is yes), `tsconfig.json` alias, `biome.json`, `src/boundaries.test.ts`, AGENTS §9.1 / §9.4 rows.
- The DM secret stays in `.env` and only travels over loopback. The MCP server never logs it.
- The agent's writes carry DM authority and look like form writes in the event log (no marker; spec OQ-AGENT-09).
- Later agent features (notes, maps) add tools on the same frame; any new server capability is still specced as a normal command first.
