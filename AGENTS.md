# AGENTS.md — Conventions

Applies to every agent (and human) working in this repo. §1–3 apply to all work. §4–8 are for spec work (`spec/*` branches). §9 is for build work (`build/*`, `fix/*` branches).

## 1. How we talk

- We are two people discussing an idea. Conversational.
- Short replies. If a reply needs more than ~15 lines, lead with the one question or decision that matters and offer to go deeper.
- Ask one or two questions at a time. Batch only for trivial facts.
- Don't restate the brief back. Don't summarise what you're about to do.
- Options: give 2–3, one-line tradeoff each, and state your pick.

## 2. How we write docs

- A spec is readable in five minutes.
- Bullets over prose. Tables where they help. No filler, no preamble.
- Use terms from [docs/glossary.md](docs/glossary.md). Don't invent synonyms.
- Placeholders are explicit: `> TODO (spec phase): ...`
- Never present something undecided as decided. Raise it as an open question.
- Relative links only. Mermaid for diagrams.
- UI/UX sections reference [visual-direction](docs/design/visual-direction.md); don't invent styling.

## 3. Hard rules

**All work**
- One task per worktree. Settled decisions are in [ADRs](docs/architecture/adr/README.md). Don't contradict them; raise an open question or propose a superseding ADR.
- Never commit secrets, `.env`, DB files, `data/` or `.verify/`.

**Spec work** (`spec/*`)
- No application code, package files, lockfiles, CI or build config.
- Edit **only your own spec file** (plus new files you create — see §5).

**Build work** (`build/*`, `fix/*`)
- Application code, tests and fixtures are allowed, inside your feature's folders ([§9.1](#91-directory-layout-and-path-aliases)). `fix/*`: only the paths the orchestrator assigns. Skeleton: see [§9.9](#99-shared-files).
- **Shared files** ([§9.9](#99-shared-files)) change only via the orchestrator. This includes `docs/data-model/` and `docs/protocol/`.
- Don't edit specs or ADRs. A spec gap or conflict → report it to the orchestrator.
- No dependency outside [ADR-0001](docs/architecture/adr/0001-tech-stack.md) and [§9.7](#97-tooling-lint-and-typecheck) without the DM's OK.

## 4. Claiming a feature

1. Check the [spec index](docs/specs/README.md) and the spec's front matter.
2. In your worktree, set front matter: `owner: <your-worktree-name>`, `status: claimed`. Commit that change first.
3. Move status as you go: `claimed → draft → in-review`. Only the reviewer (the DM, a human) sets `complete`.

Front matter is the source of truth. The index table is updated by the integrator at merge (avoids merge conflicts).

## 5. Where to write

| You want to… | Do this |
|---|---|
| Specify your feature | Edit your spec in `docs/specs/` |
| Ask something local to your feature | Add a row to your spec's **Open questions** |
| Need something from another spec | Add an open question in **your** spec naming the other spec. Don't edit theirs. |
| Make a cross-cutting decision | Create `docs/architecture/adr/proposed-<slug>.md` (integrator numbers it at merge) |
| Add/change a glossary term | Open question in your spec: `Glossary: …` |
| Log a decision | Don't. Integrator appends to `decisions-log.md` at merge. |

## 6. Cross-linking

- Link specs by relative path and section anchor, e.g. from a spec: `[combat HP](combat-tracker.md#8-data-model)`.
- Reference ADRs by number and link, e.g. from a spec: `[ADR-0005](../architecture/adr/0005-server-authoritative-sync.md)`.
- Requirement IDs: `FR-<PREFIX>-NN` (prefix in each spec's front matter). Reference them across specs.
- Open question IDs: `OQ-<PREFIX>-NN`.

## 7. Raising an open question

Row in your spec's Open questions table:

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|

- `Blocking? = yes` if your spec can't reach `complete` without an answer.
- If it affects more than your spec → also draft a proposed ADR.

## 8. Definition of "spec complete"

- [ ] Every template section filled or explicitly marked N/A with a reason.
- [ ] No `TODO (spec phase)` left.
- [ ] Functional requirements numbered and each testable.
- [ ] DM view and player view both described.
- [ ] Data model lists entities, fields, relations, derived values.
- [ ] Every WS event lists its visibility rule.
- [ ] Disconnect, reconnect and server-crash behaviour stated.
- [ ] Test plan names fixtures, a bundle and a browser walkthrough, and runs isolated per worktree ([ADR-0008](docs/architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](docs/architecture/adr/0017-agent-verification-fixture-library.md)).
- [ ] No blocking open questions. Non-blocking ones have an owner.
- [ ] Consistent with all accepted ADRs and the glossary.
- [ ] Readable in five minutes.

## 9. Build-phase conventions

For `build/<feature>` and `fix/<slug>` worktrees. Stack: [ADR-0001](docs/architecture/adr/0001-tech-stack.md) plus the tooling in [§9.7](#97-tooling-lint-and-typecheck) (DM-approved, [decisions #110](docs/decisions-log.md)). Roles and loop: [orchestrator prompt §3–5](docs/agents/orchestrator-prompt.md#3-herdr). `<feature>` = the spec's file slug (e.g. `combat-tracker`).

### 9.1 Directory layout and path aliases

One package, no workspaces ([ADR-0002](docs/architecture/adr/0002-single-package.md)).

| Path | Alias | Contains | May import |
|---|---|---|---|
| `src/server/` | `@server/*` | Bun + Hono entry (`index.ts`), app + RPC type (`app.ts`), `config.ts`, `db/`, `commands/` (command context), `events/` (bus, event log), `ws/` (hub, snapshot, visibility filter), `features/<feature>/` | `@shared` |
| `src/shared/` | `@shared/*` | zod schemas + inferred types for server and both clients: `protocol/`, `events/`, `<feature>/` | zod only |
| `src/client/common/` | `@ui/*` | shadcn/ui components, WS client, store helpers, `features/<feature>/` parts used by **both** clients | `@shared` |
| `src/client/dm/` | `@dm/*` | DM client: `index.html`, `main.tsx`, `features/<feature>/` | `@shared`, `@ui` |
| `src/client/player/` | `@player/*` | Player client: `index.html`, `main.tsx`, `features/<feature>/` | `@shared`, `@ui` |
| `fixtures/` | `@fixtures/*` | Fixture library, TypeScript modules ([§9.3](#93-fixtures)) | `@server`, `@shared` |
| `e2e/` | — | Playwright specs; `e2e/support/` helpers | anything |
| `scripts/` | — | Bun scripts behind `bun run` ([§9.4](#94-commands-and-scripts)) | anything |

- **Import boundaries**, enforced by a `bun test` boundary test and Biome restricted imports:
  - `@ui` must not import `@dm` or `@player`. `@dm` and `@player` must not import each other.
  - Clients (`@ui`, `@dm`, `@player`) may only `import type { AppType } from "@server/app"` (Hono RPC, erased at build). Nothing else from `@server`. The player bundle therefore never contains DM or server code.
- Two Vite entry points: `src/client/dm/index.html`, `src/client/player/index.html`. Build output `dist/client/`, served by Hono. URL routes per [campaign-management](docs/specs/campaign-management.md): DM `/`, player `/p/<token>`, REST `/api/*` *(proposed; [OQ-CAMP-15](docs/specs/campaign-management.md#15-open-questions) open)*.
- Feature code lives in its own `features/<feature>/` folders. Tests sit next to code as `*.test.ts`.
- Only `src/server/config.ts` reads `process.env`; it parses it with zod and exports a `parseConfig(env)` that tests call directly.

### 9.2 Env, ports and data

Implements [ADR-0008](docs/architecture/adr/0008-parallel-dev-isolation.md). Values live in `<worktree>/.env` (gitignored, auto-loaded by Bun). `.env.example` is committed.

| Var | Default | Meaning |
|---|---|---|
| `PP_SLOT` | **required** | Worktree port slot, 0–49. Written by `env:init`. No `.env` / no slot → `dev`, `start`, `fixtures:*` refuse with "run `bun run env:init`" |
| `PP_PROFILE` | `dev` | `dev` / `verify`. Also `--profile <name>` on commands |
| `PP_HOST` | `127.0.0.1` | Bind address (cloudflared connects locally) |
| `PP_PORT`, `PP_VITE_PORT` | from slot + profile | Explicit values override (`0` = OS-assigned) |
| `PP_DATA_DIR` | `data/<profile>` | Runtime data root. Relative paths resolve from the **worktree root**, never the cwd |
| `PP_DB_PATH` | `$PP_DATA_DIR/pocket-plane.db` | SQLite file; holds all campaigns, one active ([decisions #108](docs/decisions-log.md)) |
| `PP_ASSET_DIR` | `$PP_DATA_DIR/assets` | Asset store |
| `PP_DATA_DISPOSABLE` | unset | `1` = this data dir may be wiped and seeded ([§9.3](#93-fixtures)). `env:init` writes `1`; a real install never sets it |
| `PP_TEST_MODE` | unset | `1` = test-only records and routes on (sync probe, [OQ-SYNC-12](docs/specs/live-sync.md#15-open-questions)). Refused unless `PP_DATA_DISPOSABLE=1`. Off by default; set it for probe walkthroughs |
| `PP_TEST_CRASH` | unset | Test-only crash hook (#163): `<command>:before-commit` / `<command>:after-commit` / `assets.ingest:after-files` (server) or `fixture:<key>` (`fixtures:*`, before that fixture's first commit). The process SIGKILLs itself there (no exit handlers; lock left stale). Refused unless `PP_TEST_MODE=1` and `PP_DATA_DISPOSABLE=1` |
| `PP_DM_SECRET` | **required** | DM secret, min 12 chars, env only, never stored ([OQ-CAMP-03](docs/specs/campaign-management.md#15-open-questions)). Server refuses to start without it. `env:init` writes a random dev value |
| `PP_PUBLIC_BASE_URL` | unset | Base for player links ([OQ-CAMP-07](docs/specs/campaign-management.md#15-open-questions)). Unset → DM client's origin + warning (pick; OQ-CAMP-07 open) |
| `PP_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

- **No `PP_TUNNEL`.** The DM runs cloudflared against `PP_PORT` and sets `PP_PUBLIC_BASE_URL` to the tunnel URL; that is ADR-0008's "tunnel on/off".
- **Ports**: `base = 4100 + 10 × PP_SLOT` (4100–4599).

| Profile | Used by | Runs | Ports | Data |
|---|---|---|---|---|
| `dev` | Builder | `bun run dev`: Hono (watch) + Vite (HMR) | Hono base+0, Vite base+1 | `data/dev/` |
| `verify` | Test agent walkthroughs | `bun run start`: Hono serves the built client, API and WS | Hono base+2 (one port) | `data/verify/` |
| (e2e) | `bun run e2e` | `start` on a temp dir | port `0` | fresh temp dir per run |
| (tests) | `bun test` | in-process | port `0` | `:memory:` DB + temp asset dir per test file |

- WS endpoint path: `/ws` *(proposed; [OQ-SYNC-15](docs/specs/live-sync.md#15-open-questions) open)* ([FR-SYNC-01](docs/specs/live-sync.md#6-functional-requirements)).
- **DM URL in dev** is the Vite port; Vite proxies `/api` and the WS path to Hono. Everywhere else (verify, e2e, real play, tunnel) one Hono port serves everything; that is the port a tunnel needs.
- Printed URLs always use `http://127.0.0.1:<port>`, never `localhost` (Windows may resolve it to `::1`).
- **Fail fast on ports**: Vite `strictPort: true`; Hono exits with a clear error if its port is taken. No fallback ports.
- **Slot claim** (`bun run env:init`): keeps an existing `.env`. Otherwise picks the lowest slot not claimed in any other worktree's `.env` (via `git worktree list`) whose ports pass a **test bind** on `PP_HOST` (catches Windows reserved ranges), then writes `.env`. Holds a lock file in the git common dir while picking. The orchestrator runs it when creating a `build/*` or `fix/*` worktree, any location (incl. `~/.herdr/worktrees/<repo>/<branch-slug>`).
- **Server lock**: on start the server writes `$PP_DATA_DIR/server.lock` (PID, port) and removes it on clean exit. A lock whose PID is alive → second server and `fixtures:*` refuse. PID dead → stale lock removed with a warning. E2E reads the actual port from it. The loader holds the same lock (owner `loader`); the server refuses to start while it is live, or while the load manifest is `resetting`/`loading` ([FR-FIX-27/28](docs/specs/fixtures-adapters.md#6-functional-requirements)).
- Builder and test agent share a worktree but not a profile, so a walkthrough never resets the builder's DB.

### 9.3 Fixtures

Implements [ADR-0017](docs/architecture/adr/0017-agent-verification-fixture-library.md). Fixtures are TypeScript modules ([OQ-FIX-02](docs/specs/fixtures-adapters.md#15-open-questions), decided); names, bundles and loader behaviour are owned by [fixtures-adapters](docs/specs/fixtures-adapters.md).

```
fixtures/
  units/<feature>/<key>.ts    setup (ordered command steps) or reference (import batch)
  bundles/<bundle>.ts         named compositions: base, session-sim, …; all build on base
  bundles/index.ts            bundle registry (append-only, §9.9)
  srd/<kind>/<slug>.ts        SRD reference data; global, source `fixture`, with licence attribution (ADR-0018); imported by reference units (e.g. `units/entities/enemy-1.ts` → `srd/monster/goblin.ts`)
  assets/{maps,tokens}/*.svg  committed SVG sources, rasterised with sharp at load
```

| Command | Spec term | Does |
|---|---|---|
| `bun run fixtures:reset [--profile p]` | `reset` | Empty the profile's DB + asset dir, recreate schema |
| `bun run fixtures:load <bundle> [--profile p]` | `load` | Load a bundle via server commands, in-process ([OQ-FIX-09](docs/specs/fixtures-adapters.md#15-open-questions)) |
| `bun run fixtures:reset-load <bundle> [--profile p]` | `reset-and-load` | Both; the normal entry point |

- **Guards** (both commands refuse, exit non-zero, change nothing): `PP_DATA_DISPOSABLE` ≠ `1`; resolved data dir not under `<worktree>/data/` or the OS temp dir; a live server lock ([OQ-FIX-10](docs/specs/fixtures-adapters.md#15-open-questions), decided: no load while the server runs; stop, load, restart).
- **SQLite reset on Windows**: delete the DB file **and** its `-wal` / `-shm` files, then the asset dir. If a file is locked (EBUSY/EPERM), stop before touching anything else and name the file and the likely holder ("stop the server or close the DB viewer").
- Canonical names (owned by fixtures-adapters): bundle `base` = one campaign + `player-1` ("Player 1"); optional `player-2`; characters `char-<name>` (e.g. `char-mira`); `campaign-second` for switch tests. Kebab-case, stable; tests may hard-code them.
- `load` prints the DM URL, DM secret (from env) and player link URL(s) for the profile's port.
- New record type → new unit(s) + a bundle that exercises it, in the same branch.

**ID / token / clock seam** (implements [OQ-FIX-12](docs/specs/fixtures-adapters.md#15-open-questions) and the [ADR-0022](docs/architecture/adr/0022-deterministic-seams.md), option A)

| On the command context | Real (default) | Seeded |
|---|---|---|
| `ctx.ids` — record IDs | random | deterministic, seeded per **fixture key** (adding a fixture never shifts another's IDs) |
| `ctx.tokens` — secret tokens (player links) and asset IDs ([ADR-0023](docs/architecture/adr/0023-asset-access-by-capability-id.md)) | CSPRNG, ≥ 128 bits | deterministic, same seeding |
| `ctx.clock` — `now()` | system clock | fixed clock per fixtures-adapters |
| `ctx.dice` — dice engine (#137) | CSPRNG | deterministic, seeded per fixture key / test |

- Commands get IDs, tokens and time **only** from `ctx`. Never `crypto.randomUUID`, `getRandomValues`, `Date.now` or `new Date()` in command code (Biome restricted globals + review). Never `Math.random` in server code. Dice: `ctx.dice` (CSPRNG real, seeded per fixture key on disposable data only), per [dice-roll-log](docs/specs/dice-roll-log.md) FR-DICE-03.
- Seeded mode exists only inside fixture load and `bun test`, and only when `PP_DATA_DISPOSABLE=1`; the seeded factory throws otherwise. The running server always uses real generators, so real player link tokens are always CSPRNG.

### 9.4 Commands and scripts

| Command | Does | Isolation |
|---|---|---|
| `bun run env:init` | Claim a slot, write `.env` (§9.2) | — |
| `bun run dev [--profile p]` | Hono (watch) + Vite; logs to stdout and `$PP_DATA_DIR/server.log` | profile ports |
| `bun run build` | Vite build of both clients to `dist/client/` | — |
| `bun run start [--profile p]` | Hono serving `dist/client/`, API and WS on one port | profile port |
| `bun test` | Unit + integration: commands, zod schemas, domain events + event log, visibility filter (DM vs player), WS hub via real socket, fixture load, import boundaries, guards | `:memory:` DB, temp asset dir, port 0 |
| `bun run e2e` | Builds, then Playwright, thin critical flows only. DM and player in separate browser contexts | port 0, temp data dir, own server |
| `bun run typecheck` | `tsc --noEmit`, whole repo | — |
| `bun run lint` | `biome check` (lint + format) | — |
| `bun run check` | `typecheck` + `lint` + `bun test`. Run before every commit | — |
| `bun run bench` | Timed perf gates (`*.bench.ts`: fog vision, scene geometry / guard / area, dice settle / notation, compendium search, map fit visibility, window placement, DM snapshot build time; harness `src/shared/bench-kit.ts`); `bun test` skips them, a new one is added to the script. Run it alone, before merging vision / fog / geometry perf work | in-process |
| `bun run state:digest [--profile p]` | Read-only per-table row counts + SHA-256 of the profile's DB (crash walkthroughs compare digests, #163) | profile data |

- **Portable scripts** (Windows + POSIX): `package.json` scripts call only `bun scripts/<x>.ts` or binaries installed as dependencies (`tsc`, `biome`, `vite`, `playwright`). No `VAR=x cmd`, `rm -rf`, shell globs or `&&` chains; put logic in a Bun script.
- `scripts/dev.ts` spawns Hono and Vite with `Bun.spawn`, prefixes their output, and stops both when either exits or on Ctrl+C. No `concurrently`.
- **Test DB schema: template DB.** A `bun test` preload builds one schema DB per run from the Drizzle schema with drizzle-kit push (the same path as dev, [ADR-0001](docs/architecture/adr/0001-tech-stack.md)); each test file opens `:memory:` from its serialized bytes. Why: no migration files during build, so parallel branches can't conflict on a migration journal, and it is fast enough for per-file isolation ([OQ-FIX-08](docs/specs/fixtures-adapters.md#15-open-questions)). `fixtures:reset` also uses push. `drizzle-kit generate` migrations start at release.
- Tests build config with `parseConfig` (disposable + test mode on); no `.env` needed. Name tests after requirements: `test("FR-CBT-03 applies damage card", …)`.

### 9.5 Test IDs

- Attribute: `data-testid="<prefix>-<area>-<element>"`, kebab-case, `<prefix>` = spec prefix lowercased (e.g. `cbt-damage-card-apply`, `sync-connection-status`). Shared shell parts use `ui-`.
- Required on every interactive element and every element a walkthrough or E2E asserts on.
- Repeated records: same `data-testid` plus `data-record-id="<id>"`. Never encode index or label text in the ID.
- Same ID in DM and player client = same meaning.
- Canvas (react-konva): node `name` = test ID, node `id` = record ID. Query helper lives in `e2e/support/`.
- Playwright: `page.getByTestId(…)`. Text/role selectors only for asserting copy.

### 9.6 Browser verification (test agents)

- Test agents only; builders don't run long browser sessions ([orchestrator §4](docs/agents/orchestrator-prompt.md#4-context-management)).
- Tool: **Playwright MCP**, one isolated browser context per role: `dm`, `player-1`, `player-2`… Never share storage or cookies between contexts.
  - Configured per repo as three servers, one per role: `pw-dm`, `pw-player-1`, `pw-player-2` (headless, in-memory profiles). Each supported agent CLI reads its own repo config: `.mcp.json` (Claude Code, enabled in `.claude/settings.json`), `opencode.json` (opencode). Keep them identical; adding a CLI = adding its config file. Use only the server for the role you're driving. A new agent session loads them; a running session needs a restart.
- **Never start a long-running server from the agent's own shell tool** (on Windows the tool waits on the child's inherited output handles and hangs, even with `Start-Process`). The orchestrator gives each test agent a dedicated Herdr pane: start with `herdr pane run <pane> "<env>; bun run start"`, stop with `herdr pane send-keys <pane> ctrl+c`, read logs with `herdr pane read <pane>`. Parallel test agents in one worktree each get their own `PP_PORT` and `PP_DATA_DIR=data/verify-<name>`.
- Run on the `verify` profile, built client (no HMR mid-walkthrough): `bun run build`, `fixtures:reset-load <bundle> --profile verify`, `start --profile verify`. Code changed since? Stop, rebuild, restart.
- Evidence under `<worktree>/.verify/<run-id>/` (gitignored), `run-id = <yyyymmdd-hhmmss>-<feature>-<walkthrough>`:

| File | Content |
|---|---|
| `report.md` | PASS/FAIL per step, repro for failures |
| `NN-<step>-<context>.png` | Screenshot per step and context |
| `console-<context>.log` | Browser console errors/warnings |
| `server.log` | Server log excerpt for the run |

- Teardown: stop the server, `fixtures:reset --profile verify`.

### 9.7 Tooling, lint and typecheck

- Decided by the DM ([decisions #110](docs/decisions-log.md)): TypeScript `tsc --noEmit`, Biome (lint + format), Playwright MCP for test agents, committed SVG fixture images rasterised with `sharp`.
- TypeScript `strict`; one `tsconfig.json` with the §9.1 aliases (Vite and Bun read the same paths).
- No `any`, `@ts-ignore` or Biome suppressions without a one-line reason comment.
- zod is the source of truth for boundary types: `z.infer`, no hand-written duplicates.

### 9.8 Done for a build task

- [ ] Every FR-<PREFIX>-NN implemented, each with a named test.
- [ ] Every capability is a server command: validated intent → mutate + event-log append in one transaction (unless non-logged per spec) → domain event → listeners, incl. broadcaster → visibility filter → WS ([ADR-0016](docs/architecture/adr/0016-domain-events-pending-actions.md)). No feature logic in clients. IDs, tokens, time from `ctx` (§9.3).
- [ ] Visibility rule per record type tested for DM and player. Disconnect, reconnect and crash behaviour from the spec tested.
- [ ] Fixtures + bundle added; `fixtures:reset-load <bundle>` works from empty.
- [ ] Test IDs on all interactive UI.
- [ ] `bun run check` and `bun run build` green; thin `bun run e2e` green.
- [ ] Spec §13 walkthrough PASSed by a test agent; evidence path in the report.
- [ ] Shared files changed only per §9.9. Rebased on `main`. One commit per slice. No `.env`, `data/`, `.verify/`.

### 9.9 Shared files

| Shared file | Path |
|---|---|
| DB schema | `src/server/db/` |
| Domain event types | `src/shared/events/` |
| Protocol schemas (envelope, intents, record changes, snapshot, errors, close codes) | `src/shared/protocol/` |
| Server core | `src/server/{config.ts,commands,events,ws}/`, `src/server/index.ts` |
| Existing shared UI | edits to existing files in `src/client/common/` (new files are fine). Exception: a feature's own `src/client/common/features/<feature>/` files belong to that feature's builder (#154); play-shell's frame files stay shared |
| Tooling | `package.json`, `bun.lock`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `biome.json`, `.env.example`, `.gitignore`, `scripts/` |
| Docs | `docs/data-model/`, `docs/protocol/`, specs, ADRs, glossary, decisions log, `AGENTS.md` |

- **Skeleton exception**: the Phase 2 skeleton branch ([orchestrator §6](docs/agents/orchestrator-prompt.md#6-phases-and-gates)) owns and creates every shared file. No other `build/*` branch starts until it merges.
- **`fix/*`** branches edit only the paths the orchestrator assigns.
- **Append-only registries** (route mounts in `src/server/app.ts`, listener registry, record-type/visibility registry, `fixtures/bundles/index.ts`, client window registries `src/client/dm/windows.ts` and `src/client/player/windows.ts` ([OQ-SHELL-07](docs/specs/play-shell.md#15-open-questions), [ADR-0025](docs/architecture/adr/0025-play-shell-windows.md); the play-shell frame creates them empty before other builders register), entities' server definition-changed hook registry and DM `creatureActions` registry ([OQ-ENT-14](docs/specs/entities.md#15-open-questions)), server feature list `src/server/features/index.ts`, log-entry kinds `src/shared/dice-roll-log/kinds.ts`, server notification kinds `src/server/features/notifications/kinds.ts`, client notification views `src/client/dm/notification-views.ts` and `src/client/player/notification-views.ts` ([OQ-NOTE-10](docs/specs/notifications.md#15-open-questions)), character-sheet roll routes `src/client/common/features/character-sheet/roll-routes.ts` ([OQ-CHAR-13](docs/specs/character-sheet.md#15-open-questions)), scenes-map's server token-changed hook registry ([ADR-0028](docs/architecture/adr/0028-token-changed-hooks.md), FR-MAP-30) and client token menu / double-click registry (FR-MAP-29, CON-33), client token overlays `src/client/common/features/scenes-map/token-overlays.ts` (FR-MAP-34, #154), combat rule hooks `src/server/features/combat-tracker/rule-hooks.ts` ([ADR-0035](docs/architecture/adr/0035-combat-rule-hooks.md)), roll hooks `src/server/features/dice-roll-log/roll-hooks.ts` ([ADR-0038](docs/architecture/adr/0038-effect-modifiers.md)), scenes-map's scene visibility hooks `src/server/features/scenes-map/visibility-hooks.ts` and scene lifecycle hooks `scene-hooks.ts` ([ADR-0039](docs/architecture/adr/0039-fog-visibility.md); created by `fix/fog-core`; member `mapChanged` added by `fix/vision-s4-core`, [ADR-0047](docs/architecture/adr/0047-party-vision.md)), move guards `src/server/features/scenes-map/move-guards.ts` ([ADR-0040](docs/architecture/adr/0040-token-move-guards.md); hint phase `moveHints`, [ADR-0047](docs/architecture/adr/0047-party-vision.md)) and canvas tools `src/client/common/features/scenes-map/canvas-tools.ts` (both created by `fix/scn-core`), character sheet sections `src/client/common/features/character-sheet/sheet-sections.ts` ([character-sheet-full](docs/specs/character-sheet-full.md)), campaign-management player hooks `src/server/features/campaign-management/player-hooks.ts` ([ADR-0042](docs/architecture/adr/0042-dynamic-vision.md), created by `fix/vision-core`), combat apply hooks `src/server/features/combat-tracker/apply-hooks.ts` and DM popup parts `src/client/dm/features/combat-tracker/popup-parts.ts` ([ADR-0043](docs/architecture/adr/0043-rule-triggers.md), created by `fix/rt-core`), tray extras `src/client/common/features/dice-extras/tray-extras.ts` ([dice-extras](docs/specs/dice-extras.md), created by `build/dicex-tray`), effect hooks `effectHooks` `src/server/features/combat-extras/effect-hooks.ts` ([ADR-0049](docs/architecture/adr/0049-trigger-state.md), created by `fix/rules4-core`), Preferences sections `src/client/dm/pref-sections.ts` and `src/client/player/pref-sections.ts` ([play-shell](docs/specs/play-shell.md) FR-SHELL-72, created by `build/prefs-window`), campaign feature switches `src/shared/campaign-management/features.ts` ([ADR-0058](docs/architecture/adr/0058-feature-switches.md), created by `fix/gems-core`), game-log entry actions `src/client/common/features/dice-roll-log/entry-actions.ts` (created by `build/gems-reroll`) and damage-card actions `src/client/common/features/combat-tracker/card-actions.ts` (created by `build/gems-combat`) ([gems](docs/specs/gems.md)); each created empty by its owner's build, paths per [protocol §26](docs/protocol/README.md#26-combat-registries-and-seams)): a builder may add its own lines; nothing else.
- To change a shared file, the builder **stops** and reports `shared change needed: <path> — <what> — <why>`. The orchestrator picks one:
  1. **Sequence**: the builder makes the change in its branch while no other active branch touches that file. The orchestrator records the lock in `docs/agents/status.md`.
  2. **Shared branch first**: a separate `fix/<slug>` makes the change, merges to `main`, and active builders rebase.
- `docs/data-model/` and `docs/protocol/` change in the same merge as the matching schema/event/protocol code, written by whoever the orchestrator assigns.
- Change contradicts a `complete` spec or an ADR → stop; the orchestrator takes it to the DM.
