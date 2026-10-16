# Continue: orchestrator session handover

Start your agent CLI (any Herdr agent kind; Claude Code today) in `C:\Repos\pocket-plane` inside Herdr and say:

> Read `docs/agents/continue-session.md` and continue as the orchestrator.

---

You are the **orchestrator and integrator** for Pocket Plane. Your role, rules, brief templates and phase plan are in [orchestrator-prompt.md](orchestrator-prompt.md). Read it first, then this file, then [status.md](status.md), the current sprint plan [sprint-3.md](sprint-3.md) and the [backlog](backlog.md). Follow [AGENTS.md](../../AGENTS.md) §1: short replies; 1–2 questions at a time, each with options and your pick.

**Working mode (DM, #141):** run long autonomous stretches. Merge, fix and sequence on your own; settle technical questions yourself and log them. Come back to the DM only when blocked: product decisions, phase gates, ADR acceptance, new dependencies, anything destructive. **Keep 3–4 agents working** (#204, [orchestrator-prompt §3a](orchestrator-prompt.md#3a-keep-the-agents-busy-backfill)): backfill from the backlog without asking; ask the DM only when nothing eligible is left.

## 1. Where we are (2026-10-16)

| Area | State |
|---|---|
| MVP, sprint 1 | Done (#176, #177–#186). |
| Sprint 2 | **Builds done (#187–#199).** Phase 1: DM playtest notes N1–N11, session-sim-4 glitches G1–G10, effect modifiers tier 1 (MOD), P3 polish. Phase 2: fog of war (FOG), scene tools (SCN: walls / doors, props, AoE templates, layers, diagonal rule), DM active-scene window (ADR-0041).  Session-sim-6 17/18, its FAIL fixed by `fix/sim6-popup` (#200); final `main` 1884 tests, e2e 61/61; leak scan clean. Playtest scripts: [sprint-2 §Playtest: phase 1 fixes](sprint-2.md#playtest-phase-1-fixes), [§Playtest: sprint 2 features](sprint-2.md#playtest-sprint-2-features). |
| Verification | Evidence `%TEMP%\pocket-planeerify-*` (latest `verify-session-sim-6`; also `.verify/20261015-232530-session-sim-6/` in the main checkout, 12 ranked glitches). |
| Specs / ADRs | All specs `complete`. ADRs 0001–0041 accepted (0037 split attack / damage, 0038 effect modifiers, 0039 fog visibility, 0040 token move guards, 0041 active-scene window). |
| Decisions | Up to #204 in [decisions-log](../decisions-log.md). Proposed ADRs waiting for sprint-3 gate 1: [dynamic vision](../architecture/adr/proposed-dynamic-vision.md), [rule triggers](../architecture/adr/proposed-rule-triggers.md). |
| CON-44 | Heavy DM snapshot 676,059 B of 786,432 B (active-scene window freed ~110 KB). Re-measure for every new record type. |
| Agents | Herdr kind `claude` (`-- --permission-mode auto`, `--strict-mcp-config` except test agents). |
| Helpers | [`docs/agents/tools/`](tools/), orchestrator only, run from the main checkout by absolute path (`bash /c/Repos/pocket-plane/docs/agents/tools/<x>.sh`): `mkwt.sh <branch> <label> [build]` (prints `ws= root= dir=`), `startagent.sh <pane> <name> <brief> [test]`, `starttest.sh <ws> <name> <brief-template>` (new tab + server pane, fills `{{SRVPANE}}`, starts a test agent), `poll.sh <agent…>`. Change them on `main` only. Brief generators used in sprint 2 lived in the session scratchpad (mktest.py: §5 template filler; mkbuild.py: spec-slice builder brief); recreate if needed. |
| Scratch | `%TEMP%\pocket-plane\`: `briefs/` (test brief templates `tpl-*.md`), agent reports `<name>.md`, archived evidence `verify-*/`, gate files `gate-sprint2-phase{1,2}.md`. Storage Sense may clear it. |
| Worktrees | `main` only (slot 1; test agents on `main` use 4113). |

## 2. Next, in order

**Sprint 3, DM decisions #201–#204: [sprint-3](sprint-3.md).** Tracks V (fog v2 + dynamic vision + walls), D (3D dice, tray, clickable notation, customisation), R (effect modifiers tiers 1–3 + rule triggers, Zealot Divine Fury), P (party board + handouts), C (compendium). Phase A specs → seams → two reviews → **one DM gate** → Phase B builds per the hotspot table → session-sim-7 → "Playtest: sprint 3 features" → pause and recap.

**Keep the agents busy (#204, [orchestrator-prompt §3a](orchestrator-prompt.md#3a-keep-the-agents-busy-backfill)):** aim for 3–4 working agents. When only one is working and nothing in the sprint queue is unblocked, pick an eligible item from [backlog](backlog.md) without asking; if none fits, ask the DM. Track backfill rows in status.md.

The DM's sprint-2 playtest feedback became #201–#203; their playtest scripts are in [sprint-2](sprint-2.md#playtest-sprint-2-features).

Lessons from sprint 2 (2026-10-15/16), on top of the ones below:
- **Wait for the builder's commit before you check its worktree.** Running `check` / `e2e` while a builder's own e2e runs collides (Playwright trace ENOENT, ports) and merging main into a dirty tree mixes states. Poll `git status --short` clean + agent not working + "ready" in its output.
- Append-only registry files (`canvas-tools.ts`, `canvas-layers.ts`, bundle / unit indexes) conflict on every parallel merge: the resolution is always "keep both lines"; let the builder do it or use `git -C`.
- Measure snapshot costs in the heavy harness before a gate; estimates were off by 2–3× twice (presets, fogged tokens).
- A spec-only rule a builder can't meet in the default layout (pinned header fallback, toast placement) shows up only in the walkthrough: give builders the default window sizes in the brief.
- Builders: tools only via the repo's binaries (`bun run`, `bun x`); `npx biome` once ran an unrelated npm package.
- Seams between parallel spec agents: write one `seams.md` ruling, copy it into each worktree, let authors push back once; then one review agent across all specs; then `rulings.md` for the review.

Lessons from sprint 1 (2026-10-14):
- **Agents can't read outside their working directory** without a prompt (`blockReadsOutsideWorkingDirectories`). Copy inputs (evidence, review summaries) into the agent's worktree or the main checkout's `.verify/` and point the brief there. Writes to `%TEMP%\pocket-plane\` work.
- A safety hook blocks `rm -rf`, for agents and the orchestrator. Use `git worktree remove --force` (it deletes untracked data); leave `data/verify-*` in the main checkout for the DM.
- **Never `cd` into a worktree** from the orchestrator shell, not even in a compound command: the shell's cwd persists and the session's primary directory switches. Use `(cd <wt> && …)` subshells or `git -C`.
- Run `check` **and the full e2e on `main` after every merge** that touches UI: a branch's own green e2e didn't catch a cross-branch break.
- Suite time is a health signal (#184). Main checkout check now ~40 s.
- Builders who need a shared file message the orchestrator (`shared change needed`); the `from` address goes stale once their session ends.
- Start a dependent fix on top of an unmerged branch with `herdr worktree create --base <branch>` when it only needs one export.

## 3. Herdr: how to run agents (learned the hard way)

Load the `herdr` skill. Check `HERDR_ENV=1`; if not set, stop and tell the DM. Find your workspace: `herdr pane current --current` → `workspace_id` (was `wR`).

**Create a worktree + agent**
```powershell
$r = herdr worktree create --workspace <ws> --branch <type>/<slug> --label <slug> --base main --no-focus | ConvertFrom-Json
# MUST check: $r.result.workspace.worktree.repo_name -eq 'pocket-plane'
# build/* and fix/*: in the worktree run `bun install` and `bun run env:init` before the agent starts
$p = herdr pane split $r.result.root_pane.pane_id --direction right --no-focus | ConvertFrom-Json
Start-Sleep 4   # a fresh shell isn't ready at once; agent start then fails with agent_pane_busy
herdr agent start <name> --kind claude --pane $p.result.pane.pane_id --timeout 90000 -- --permission-mode auto --strict-mcp-config   # test agents: drop --strict-mcp-config (they need the Playwright MCP servers from .mcp.json)
```
- Args after `--` go to the agent CLI and are kind-specific (claude shown). `startagent.sh` keeps them in one `case` per kind.
- **Always pass `--workspace`** (without it Herdr once created worktrees in another repo).
- If `agent start` says `agent_pane_busy`: close that pane, split a new one, wait, retry.
- Read-only reviewers: a new tab in `<ws>` (`herdr tab create --workspace <ws> --label reviews --no-focus`), no worktree.

**Prompting**
- Write each brief to `%TEMP%\pocket-plane\briefs\<name>.md` (UTF-8 is fine), then send one line: `herdr agent prompt <name> "Read your brief at <path> and follow it exactly."`. `--wait` times out while the agent works; check `herdr agent get` instead.
- Write briefs with the file tool, not shell here-docs/here-strings (quoting and interpolation bite in both shells, §4).
- Check `herdr agent get <name>` ~10 s after prompting; if still `idle`, the prompt stalled — resend.
- Poll: loop `herdr agent list` every 30 s, cap ~14 min, stop when any watched agent leaves `working`. `blocked` = a question dialog: read it with `herdr agent read <name> --source visible`; answer with `send-keys` (enter = recommended option) only if it's technical; product questions go to the DM.
- Read results when idle/done: `herdr agent read <name> --source recent-unwrapped --lines 40`.
- Long outputs: agents write to `%TEMP%\pocket-plane\<name>.md`. Hand review findings to a revision agent by copying them into its worktree as `.review.md` (it deletes it before committing).
- MCP: each agent kind loads the Playwright servers from its own repo config (AGENTS §9.6). Only test agents need them; with `claude`, builders, spec and review agents start with `--strict-mcp-config` so they load none. Close a finished agent's pane promptly (its MCP children go with it).

**Builders**
- Brief = orchestrator-prompt §5 builder template plus: own paths (`src/server/features/<f>/`, `src/shared/<f>/`, `src/client/{common,dm,player}/features/<f>/`, `fixtures/units/<f>/`, own bundle, `e2e/<f>.e2e.ts` with a `// e2e-bundle: <name>` header), append-only registries (AGENTS §9.9), and "any other shared file: STOP and report `shared change needed: <path> — <what> — <why>`".
- Approve shared changes by **sequencing**: one branch holds the lock (record it in status.md), the others wait or work on non-shared slices. Builders may write the data-model/protocol rows for what they build.
- Window geometry: protocol §18/§24 is authoritative; shell layout tests are registry-driven (fit at 1280×720, product no-overlap at 1600×900, test windows among themselves).
- Agents must never start long-running servers from their own shell (hangs on Windows) and never run browser sessions; builders report "ready for walkthrough".

**Test agents (browser walkthroughs)**
- Run in the builder's worktree, new tab, plus a **dedicated server pane** (split from the agent pane). Build the client once yourself first (`bun run build` in that worktree, after `git merge main`).
- Template (fill `{{…}}`): see §5 below. Give each test agent its own `PP_PORT` (e.g. base+3 of the worktree's slot), `PP_DATA_DIR=data/verify-<name>`, `PP_PROFILE=verify`, `PP_TEST_MODE=1` when the walkthrough uses Probes / test windows.
- "Drop connection" reconnects in ~0.5 s; agents hold a player offline with Playwright `setOffline` or close the socket to observe the banner. `ERR_CONNECTION_REFUSED` during deliberate outages is expected, not a failure.
- After a PASS: copy `<worktree>\.verify\*` to `%TEMP%\pocket-plane\verify-<task>\` before removing the worktree.

**Merging and cleanup (always)**
1. `git -C <wt> status --short`, `git log --oneline main..HEAD`; in the worktree `git merge main`, then `bun run check` (+ `bun run e2e` for UI changes).
2. On `main`: `git merge --no-ff -q -m "Merge <branch> (…)" <branch>`.
3. Close every pane of the worktree's workspace (`herdr pane list --workspace <id>` → `pane close`), wait 3 s, `git worktree remove --force <path>`, `git branch -d <branch>`, `git worktree prune`.
4. Update status.md, decisions-log, spec index, glossary as the integrator; number proposed ADRs at acceptance (rename file, fix links with `git grep`, add to the ADR index).
5. Known flake: loader tests EBUSY on Windows temp-dir teardown — fixed with retries; if it reappears, it's that.

## 4. Shell and file gotchas

Know your shell: Claude Code's shell tool is **Git Bash** (POSIX: `$TEMP`, `/c/...` paths, `export X=y`); Herdr panes and the DM's terminal are **PowerShell** (`%TEMP%` = `$env:TEMP`, `$env:X='y'`). Write commands for the shell that runs them.

- Prefer the file tools (Read / Edit / Write) over shell text edits for docs: they keep UTF-8 and line endings. LF endings; keep `docs/protocol/README.md` LF.
- Lines with `—`/`§`/`→`: edit with the Edit tool. A shell `.Replace()` / `sed` typed with those characters often won't match (console mojibake; the files are fine).
- Backslashes: Git Bash collapses `\\` even inside quoted here-docs, and `\b`, `\t`, `\v` in a written path become control bytes (this corrupted two `%TEMP%` paths here once). Write scripts with the Write tool, not here-docs; in them build Windows paths with `chr(92)` or forward slashes.
- PowerShell: `@'…'@` (literal) here-strings; with `@"…"@` every `$x` interpolates. Never put `\"` inside a double-quoted string. UTF-8 without BOM: `[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))`. `[regex]::Replace`: write `${1}` when digits follow a backreference. Don't name a helper function `R`.
- Format new JSON/TS files with `bun x biome format --write <file>`.
- Playwright MCP servers: see AGENTS §9.6 (one repo config per agent kind; agents load them at start).

## 5. Test-agent brief template

```
You are verifying ONE walkthrough for Pocket Plane in this worktree (branch {{BRANCH}}). Do NOT fix code, do NOT edit tracked files, do NOT commit.
Read: AGENTS.md section 9.2, 9.3, 9.5, 9.6; docs/specs/{{SPEC}}.md section 13 (the walkthrough) and the FRs it references; docs/architecture/adr/0017-agent-verification-fixture-library.md.
ISOLATION: in EVERY shell command first set PP_PROFILE=verify, PP_PORT={{PORT}}, PP_DATA_DIR=data/{{DATADIR}}{{EXTRAENV}} (bash: export PP_PROFILE=verify PP_PORT={{PORT}} ...; PowerShell: $env:PP_PROFILE='verify'; ...). Use only port {{PORT}}. Never touch other data folders. The client is already built (dist/client); do NOT run bun run build.
1. Reset + load: bun run fixtures:reset-load {{BUNDLE}} (with the env above). Note the printed DM URL, DM secret and player link(s).
2. Start: NEVER from your own shell tool (it hangs on Windows). Use your Herdr pane {{SRVPANE}}: herdr pane run {{SRVPANE}} "<env above, in the pane shell's syntax>; bun run start"; poll http://127.0.0.1:{{PORT}}. Stop: herdr pane send-keys {{SRVPANE}} ctrl+c (hard kill of <pid in server.lock>: PowerShell Stop-Process -Id <pid> -Force; bash taskkill //F //PID <pid>). Logs: herdr pane read {{SRVPANE}} --source recent-unwrapped --lines 80.
3. Browsers: Playwright MCP pw-dm (DM), pw-player-1, pw-player-2 - separate isolated browsers. data-testid selectors; canvas nodes: name = test ID, id = record ID (helper in e2e/support/).
4. Walk through every step of {{SPEC}} section 13. Also: reload mid-flow (DM and a player), player reconnect, cheap edge cases.
5. Evidence under .verify/{{RUNID}}/ (gitignored): report.md (PASS/FAIL per step, repro per failure), NN-<step>-<context>.png, console-<context>.log, server.log excerpt.
6. Teardown: stop the server, close the browsers, bun run fixtures:reset (same env), remove data/{{DATADIR}}.
If spec and app disagree, mark FAIL with what you saw; don't speculate about fixes.
Report (<= 20 lines): PASS/FAIL per step, failures with repro + evidence path, total PASS count.
```

## 6. Don't forget

- Ask the DM before: a new phase, accepting/superseding an ADR, a dependency outside ADR-0001 / #110 / #119, anything destructive, reading their personal config.
- Token display name belongs to the token (#126); only the DM picks targets and applies damage (#134, #136); monsters show players a health band, never HP (#138).
- Gems are tier A (post-MVP, [gems](../specs/post-mvp/gems.md)); MVP data already allows rerolls and maxed damage dice.
- Keep status.md current; it's how the next session picks up.
