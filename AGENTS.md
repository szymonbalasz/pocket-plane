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
- Application code, tests and fixtures are allowed, inside your feature's folders ([§9.1](#91-directory-layout-and-path-aliases)).
- **Shared files** ([§9.9](#99-shared-files)) change only via the orchestrator. This includes `docs/data-model/` and `docs/protocol/`.
- Don't edit specs or ADRs. A spec gap or conflict → report it to the orchestrator.
- No dependency outside [ADR-0001](docs/architecture/adr/0001-tech-stack.md) without the DM's OK.

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

For `build/<feature>` and `fix/<slug>` worktrees. Stack: [ADR-0001](docs/architecture/adr/0001-tech-stack.md). Roles and loop: [orchestrator prompt §3–5](docs/agents/orchestrator-prompt.md#3-herdr). `<feature>` = the spec's file slug (e.g. `combat-tracker`). Items marked **Open** are not decided ([§9.10](#910-open-for-dm)).

### 9.1 Directory layout and path aliases

One package, no workspaces ([ADR-0002](docs/architecture/adr/0002-single-package.md)).

| Path | Alias | Contains | May import |
|---|---|---|---|
| `src/server/` | `@server/*` | Bun + Hono entry (`index.ts`), app + RPC type (`app.ts`), `config.ts`, `db/`, `events/` (bus, event log), `ws/` (hub, snapshot, visibility filter), `features/<feature>/` | `@shared` |
| `src/shared/` | `@shared/*` | zod schemas + inferred types used by server and both clients: `protocol/`, `events/`, `<feature>/` | nothing app-side (zod only) |
| `src/client/common/` | `@ui/*` | shadcn/ui components, WS client, store helpers, `features/<feature>/` parts used by **both** clients | `@shared` |
| `src/client/dm/` | `@dm/*` | DM client: `index.html`, `main.tsx`, `features/<feature>/` | `@shared`, `@ui` |
| `src/client/player/` | `@player/*` | Player client: `index.html`, `main.tsx`, `features/<feature>/` | `@shared`, `@ui` |
| `fixtures/` | `@fixtures/*` | Fixture library ([§9.3](#93-fixtures)) | `@server`, `@shared` |
| `e2e/` | — | Playwright specs; `e2e/support/` helpers | anything |
| `scripts/` | — | CLI entry points behind `bun run` scripts | anything |

- Two Vite entry points: `src/client/dm/index.html`, `src/client/player/index.html`. Build output `dist/client/`, served by Hono. URL routes per [campaign-management](docs/specs/campaign-management.md).
- **Player bundle never contains DM code**: `@player` must not import `@dm` or `@server`; clients may only `import type { AppType } from "@server/app"` (Hono RPC, erased at build). Enforced by an import-boundary test in `bun test` (and the linter once chosen).
- Feature code lives in its own `features/<feature>/` folders. Tests sit next to code as `*.test.ts`.
- Only `src/server/config.ts` reads `process.env`; it parses it with zod. Everything else imports config.

### 9.2 Env vars, ports and data paths

Implements [ADR-0008](docs/architecture/adr/0008-parallel-dev-isolation.md). Values live in `<worktree>/.env` (gitignored, auto-loaded by Bun). `.env.example` is committed.

| Var | Default | Meaning |
|---|---|---|
| `PP_SLOT` | `0` | Worktree port slot, 0–49. Written by `bun run env:init` |
| `PP_PROFILE` | `dev` | `dev` / `verify` / `e2e`; selects ports and data dir (below). Also `--profile <name>` on commands |
| `PP_HOST` | `127.0.0.1` | Bind address (cloudflared connects locally) |
| `PP_PORT` | from slot + profile | Hono server (REST, WS, built clients) |
| `PP_VITE_PORT` | from slot + profile | Vite dev server |
| `PP_DATA_DIR` | `./data/<profile>` (`e2e`: temp dir) | Root for this profile's runtime data |
| `PP_DB_PATH` | `$PP_DATA_DIR/pocket-plane.db` | SQLite file |
| `PP_ASSET_DIR` | `$PP_DATA_DIR/assets` | Asset store |
| `PP_TUNNEL` | `off` | `off` / `on` |
| `PP_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

- DM secret env var name follows [campaign-management](docs/specs/campaign-management.md) OQ-CAMP-03; if env-based, it is `PP_DM_SECRET`.
- **Ports**: `base = 4100 + 10 × PP_SLOT` (range 4100–4599). Explicit `PP_PORT` / `PP_VITE_PORT` override.

| Profile | Used by | Server | Vite | Data |
|---|---|---|---|---|
| `dev` | Builder | base+0 | base+1 | `data/dev/` |
| `verify` | Test agent walkthroughs | base+2 | base+3 | `data/verify/` |
| `e2e` | `bun run e2e` | base+4 | base+5 | fresh temp dir per run |
| (tests) | `bun test` | port `0` (OS-assigned) | — | `:memory:` DB + temp asset dir per test file |

- **Slot claim**: `bun run env:init` keeps an existing `.env`; otherwise picks the lowest slot not claimed in any other worktree's `.env` (via `git worktree list`) whose ports are free, and writes `.env`. The orchestrator runs it when creating a `build/*` or `fix/*` worktree. Works for any worktree location, including `~/.herdr/worktrees/<repo>/<branch-slug>`.
- Builder and test agent share a worktree but not a profile, so a walkthrough never resets the builder's DB.
- `data/` is per worktree and disposable. Dev DB uses `drizzle-kit push` ([ADR-0001](docs/architecture/adr/0001-tech-stack.md)); after a schema change, `fixtures:reset-load`.

### 9.3 Fixtures

Implements [ADR-0017](docs/architecture/adr/0017-agent-verification-fixture-library.md). File format per [fixtures-adapters](docs/specs/fixtures-adapters.md) (OQ-FIX-02).

```
fixtures/
  units/<feature>/<fixture>   small fixtures; setups are scripts of server commands
  bundles/<bundle>            named compositions of units (session-sim, mid-combat, …)
  bundles/index               bundle registry (append-only, §9.9)
  srd/<kind>/<slug>           SRD reference data; loads via import pipeline core as source `fixture`, with licence attribution
  assets/{maps,tokens}/       image sources (approach: Open, §9.10)
```

| Command | Does |
|---|---|
| `bun run fixtures:reset [--profile p]` | Empty the profile's DB + asset dir, recreate schema |
| `bun run fixtures:load <bundle> [--profile p]` | Load a bundle into the current DB via server commands |
| `bun run fixtures:reset-load <bundle> [--profile p]` | Both; the normal entry point |
| `bun run fixtures:list` | List bundles and their units |

- Names: kebab-case. Record names referenced by tests are stable (e.g. `player-1`, `enemy-1`, `town`, `battlemap`).
- `load` prints the DM URL and player link URL(s) for the profile's ports.
- Load against a running server: behaviour per [fixtures-adapters](docs/specs/fixtures-adapters.md) §11. Until defined, stop the server first.
- New record type → new unit(s) + a bundle that exercises it, in the same branch.

### 9.4 Test commands

| Command | Covers | Isolation |
|---|---|---|
| `bun test` | Unit + integration: commands, zod schemas, domain events + event log, visibility filter (DM vs player), WS hub via real socket, fixture load, import boundaries | `:memory:` DB, temp asset dir, port 0 |
| `bun run e2e` | Playwright, thin critical flows only. DM and player in separate browser contexts | `e2e` profile ports, temp data dir, own server |
| `bun run typecheck` | Whole repo, strict | — |
| `bun run lint` | Lint + format check | — |
| `bun run check` | `typecheck` + `lint` + `bun test`. Run before every commit | — |
| `bun run build` | Vite build of both clients | — |
| `bun run dev [--profile p]` | Server (watch) + Vite on the profile's ports; logs to stdout and `$PP_DATA_DIR/server.log` | per profile |

- Name tests after requirements: `test("FR-CBT-03 applies damage card", …)`.
- Non-deterministic inputs (dice, clock, IDs) are injected seams, never globals. Dice approach per [dice-roll-log](docs/specs/dice-roll-log.md).

### 9.5 Test IDs

- Attribute: `data-testid="<prefix>-<area>-<element>"`, kebab-case, `<prefix>` = spec prefix lowercased (e.g. `cbt-damage-card-apply`, `sync-connection-status`). Shared shell parts use `ui-`.
- Required on every interactive element and every element a walkthrough or E2E asserts on.
- Repeated records: same `data-testid` plus `data-record-id="<id>"`. Never encode index or label text in the ID.
- Same ID in DM and player client = same meaning.
- Canvas (react-konva): node `name` = test ID, node `id` = record ID. Query helper lives in `e2e/support/`.
- Playwright: `page.getByTestId(…)`. Text/role selectors only for asserting copy.

### 9.6 Browser verification (test agents)

- Test agents only; builders don't run long browser sessions ([orchestrator §4](docs/agents/orchestrator-prompt.md#4-context-management)). Tool: **Open** (§9.10). Rules hold whatever the tool.
- Run on the `verify` profile: `fixtures:reset-load <bundle> --profile verify`, then `dev --profile verify`.
- One browser context per role: `dm`, `player-1`, `player-2`… Never share storage or cookies between contexts.
- Evidence under `<worktree>/.verify/<run-id>/` (gitignored), `run-id = <yyyymmdd-hhmmss>-<feature>-<walkthrough>`:

| File | Content |
|---|---|
| `report.md` | PASS/FAIL per step, repro for failures |
| `NN-<step>-<context>.png` | Screenshot per step and context |
| `console-<context>.log` | Browser console errors/warnings |
| `server.log` | Server log excerpt for the run |

- Teardown: stop the server, `fixtures:reset --profile verify`.

### 9.7 Lint and typecheck

- TypeScript `strict`; one `tsconfig.json` with the §9.1 aliases (Vite and Bun read the same paths).
- No `any`, `@ts-ignore` or lint suppressions without a one-line reason comment.
- zod is the source of truth for boundary types: `z.infer`, no hand-written duplicates.
- Linter/formatter and typecheck tool: **Open** (§9.10). `bun run lint` / `typecheck` are the stable command names.

### 9.8 Done for a build task

- [ ] Every FR-<PREFIX>-NN implemented, each with a named test.
- [ ] Every capability is a server command: validated intent → mutate + event-log append in one transaction (unless non-logged per spec) → domain event → listeners, incl. broadcaster → visibility filter → WS ([ADR-0016](docs/architecture/adr/0016-domain-events-pending-actions.md)). No feature logic in clients.
- [ ] Visibility rule per event tested for DM and player. Disconnect, reconnect and crash behaviour from the spec tested.
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
| Protocol schemas (envelope, intents, WS events, snapshot, errors) | `src/shared/protocol/` |
| Server core | `src/server/{config,events,ws}/`, `src/server/index.ts` |
| Existing shared UI | edits to existing files in `src/client/common/` (new files are fine) |
| Tooling | `package.json`, `bun.lock`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, lint config, `.env.example`, `.gitignore` |
| Docs | `docs/data-model/`, `docs/protocol/`, specs, ADRs, glossary, decisions log, `AGENTS.md` |

- **Append-only registries** (route mounts in `src/server/app.ts`, listener registry, `fixtures/bundles/index`): a builder may add its own lines; nothing else.
- To change a shared file, the builder **stops** and reports `shared change needed: <path> — <what> — <why>`. The orchestrator picks one:
  1. **Sequence**: the builder makes the change in its branch while no other active branch touches that file. The orchestrator records the lock in `docs/agents/status.md`.
  2. **Shared branch first**: a separate `fix/<slug>` makes the change, merges to `main`, and active builders rebase.
- `docs/data-model/` and `docs/protocol/` change in the same merge as the matching schema/event/protocol code, written by whoever the orchestrator assigns.
- Change contradicts a `complete` spec or an ADR → stop; the orchestrator takes it to the DM.

### 9.10 Open for DM

Not decided until the DM picks. Bold = suggested.

| Item | Options |
|---|---|
| Linter/formatter | **Biome** (one fast tool, has import restrictions) / ESLint + Prettier (most plugins, slower, more config) / oxlint + Prettier |
| Typecheck tool (`typescript` not listed in ADR-0001) | **`tsc --noEmit`** / `tsgo` preview (faster, less mature) |
| Agent browser tool | **Playwright MCP, one isolated instance per context** (interactive; same engine as E2E) / agent-written Playwright scripts in `.verify/` (no new dependency, less exploratory) / Chrome DevTools MCP |
| Fixture images ([ADR-0017](docs/architecture/adr/0017-agent-verification-fixture-library.md)) | **SVG sources committed, rasterised with `sharp` at load** / tiny committed PNGs / generated in code |
