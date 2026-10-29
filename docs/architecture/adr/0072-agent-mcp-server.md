# 0072 — Agent MCP server: a local DM caller over stdio

- Status: accepted (DM, [#379](../../decisions-log.md); numbered at merge). Picks D1–D6 as written
- Date: 2026-10-28
- Amends: none. Builds on [ADR-0003](0003-local-hosting.md), [ADR-0004](0004-tenancy-auth-permissions.md), [ADR-0005](0005-server-authoritative-sync.md), [ADR-0006](0006-persistence.md), [ADR-0016](0016-domain-events-pending-actions.md), [ADR-0019](0019-auth-credentials.md), [ADR-0024](0024-definition-visibility.md)
- Affects: [agent-api](../../specs/agent-api.md); AGENTS §9.1 (new area), §9.4 (scripts); tooling `package.json`, `tsconfig.json`, `biome.json`, `src/boundaries.test.ts`

## Context

- #378: an MCP server lets the DM create and edit content from Claude Code. It is just another caller (server commands, event log, filter), it never touches SQLite, every tool refuses when the server isn't running, and Pocket Plane data stays on the DM's machine (tool results still reach the model provider, as in any Claude Code session).
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

**Pick A.** The throttle is server-wide and a WS `4401` covers both a wrong secret and a throttle. So the MCP server stops DM checks only after a REST **401**; a WS `4401` is first confirmed with `POST /api/dm/login` (401 → stop; 429 → `throttled`, keep going). A bad `.env` can't trip the throttle, and someone else's failed logins never get blamed on `.env` ([OQ-AGENT-06](../../specs/agent-api.md#15-open-questions)).

**D3. Finding the server and the profile**

| Option | Pros | Cons |
|---|---|---|
| **A. Read `server.lock` on every call: `owner: server`, PID alive, `port` set → `127.0.0.1:<port>`** | One truth, already written by `start` / `dev`; handles OS-assigned ports; refusal is exact | Read-only: a stale lock is left for the next `start` to clear |
| B. Compute the port from `PP_SLOT` + profile, then probe it | No file read | Wrong under `PP_PORT` overrides and port 0. Can't see a running fixture load or a server still starting. Can't tell whose server answers on the port |
| C. Explicit `PP_MCP_URL` | Flexible | Another env var to keep in sync |

**Pick A.** Checks in order: parses → PID alive → `owner: server` → `port` set. Profile = `parseConfig`'s (`PP_PROFILE`, or `--profile` in the registered command), so the MCP server resolves the same data dir as `bun run start` with the same `.env`. Always `127.0.0.1`, never the tunnel URL.

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
| May import | `@shared/*`; `@server/config` (`parseConfig`); `@server/runtime/lock` (`readLock`, `isPidAlive`; not `liveLock`, which deletes); `import type { AppType } from "@server/app"`; `hono/client` (`hc`); the MCP SDK; `node:*` and `bun:` built-ins except `bun:sqlite` |
| Must not import | Any other `@server/*`, `@ui`, `@dm`, `@player`, `@fixtures`, `bun:sqlite`, `drizzle-*` |
| Imported by | Nothing but `scripts/mcp-call.ts` and its own tests |
| Enforced | `src/boundaries.test.ts` is area-based, so this needs a new area `mcp` plus a **per-module exception**: `mcp` → `@server/config` and `@server/runtime/lock` only (alongside the existing `import type AppType` rule). The same list goes in Biome restricted imports. A test keeps `config.ts` and `runtime/lock.ts` importing only `node:*` and zod, so the exception can't leak further into server code |
| WS | A small client of its own on `@shared/protocol` frames (Bun's `WebSocket`); the browser client in `@ui` is not reused |
| Scripts | `package.json` `mcp` → `bun src/mcp/index.ts`; `mcp:call` → `bun scripts/mcp-call.ts` (spawns the stdio server, calls one tool, prints the result; exit ≠ 0 on error) |

**D6. Registering for Claude Code**

| Option | Pros | Cons |
|---|---|---|
| **A. DM-local registration in the DM's own checkout only: `claude mcp add --scope local pocket-plane -- bun run mcp`; nothing in `.mcp.json`** | Worktrees (builders, test agents) never see it; `.mcp.json` / `opencode.json` stay identical (AGENTS §9.6) | One setup step per machine. **Every** Claude session in that checkout loads it, the orchestrator and integrator included (often in auto mode), with DM write tools on that checkout's data |
| B. Entry in `.mcp.json`, not in committed `enabledMcpjsonServers`; DM enables it in `.claude/settings.local.json` | Discoverable in the repo | Test agents load `.mcp.json`, so they depend on the allow-list staying exact; `opencode.json` drifts or gains it too |
| C. Enabled in `.mcp.json` for all; builders start with `--strict-mcp-config` | One config | Test agents get write tools on their verify data; every new agent kind must remember the flag |

**Pick A**, with a mitigation: orchestrator and integrator sessions in the main checkout start with `--strict-mcp-config` (no MCP servers; they don't drive browsers). It goes in `docs/agents/tools/startagent.sh` and the continue-session handover. Also considered: registering in a separate DM-only play folder instead, which is safer by construction but means moving real play out of the main checkout. Second line of defence: tools refuse unless that checkout's server runs, and every write asks for permission (spec FR-AGENT-15). Walkthroughs and e2e use `bun run mcp:call` (real stdio path) instead of a registered server. The skill (`.claude/skills/pocket-plane-content/`) is committed. It is visible in every Claude worktree session but inert without the tools, and its description limits it to DM content requests. Skills are Claude Code only; opencode doesn't see them. AGENTS §9.6 parity covers MCP config, not skills.

## Consequences

- No server change. The new code is a client of the existing API, so its tests reuse the in-process server harness (port 0, `:memory:`).
- Shared-file changes through the orchestrator: `package.json` (scripts, the SDK dependency if [OQ-AGENT-01](../../specs/agent-api.md#15-open-questions) is yes), `tsconfig.json` alias, `biome.json`, `src/boundaries.test.ts`, AGENTS §9.1 / §9.4 rows, and `--strict-mcp-config` in the orchestrator / integrator start.
- The DM secret stays in `.env`, only travels over loopback, and never appears in any output (spec FR-AGENT-03). The DB, assets and server stay on the DM's machine. Tool results go to the model provider, as in any Claude Code session (spec OQ-AGENT-12).
- The agent's writes carry DM authority and look like form writes in the event log (no marker; spec OQ-AGENT-09).
- Later agent features (notes, maps) add tools on the same frame; any new server capability is still specced as a normal command first.
