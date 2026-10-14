# Continue: orchestrator session handover

Start your agent CLI (any Herdr agent kind; Claude Code today) in `C:\Repos\pocket-plane` inside Herdr and say:

> Read `docs/agents/continue-session.md` and continue as the orchestrator.

---

You are the **orchestrator and integrator** for Pocket Plane. Your role, rules, brief templates and phase plan are in [orchestrator-prompt.md](orchestrator-prompt.md). Read it first, then this file, then [status.md](status.md) and the current sprint plan [sprint-1.md](sprint-1.md). Follow [AGENTS.md](../../AGENTS.md) §1: short replies; 1–2 questions at a time, each with options and your pick.

**Working mode (DM, #141):** run long autonomous stretches. Merge, fix and sequence on your own; settle technical questions yourself and log them. Come back to the DM only when blocked: product decisions, phase gates, ADR acceptance, new dependencies, anything destructive.

## 1. Where we are (2026-10-14, evening)

| Area | State |
|---|---|
| MVP | **Done.** Phases 0–5 built and accepted; DM playtest feedback pass (P1–P5, G1–G12, #171–#176) merged. `main` green: 838 tests, full e2e 28/28 (8 bundles), `check` 5× in a row after the flake fix (#175). |
| Verification | Every feature walkthrough PASS; session-sim regression on final `main` 9/9 + reload, reconnect, leak scan, identical `state:digest` across a hard kill (#176). Evidence `%TEMP%\pocket-plane\verify-*` (latest: `verify-session-sim-3`). |
| Specs / ADRs | All MVP specs `complete`. ADRs 0001–0033 accepted (0033 signal audience). Post-MVP specs are stubs until sprint 1 expands two of them. |
| Decisions | Up to #177 in [decisions-log](../decisions-log.md). |
| Agents | Herdr kind `claude` since #148 (`-- --permission-mode auto`, `--strict-mcp-config` except test agents). |
| Helpers | [`docs/agents/tools/`](tools/), orchestrator only, run from the main checkout by absolute path (`bash /c/Repos/pocket-plane/docs/agents/tools/<x>.sh`): `mkwt.sh <branch> <label> [build]` (workspace = `$HERDR_WORKSPACE` or your own; prints `ws= root= dir=`), `startagent.sh <pane> <name> <brief> [test]` (kind from `AGENT_KIND`, default `claude`), `poll.sh <agent…>` (fails loudly on an unknown name), `starttest.sh <ws> <name> <brief-template>` (new tab + server pane, fills `{{SRVPANE}}`, starts a test agent). Change them on `main` only. |
| Scratch | `%TEMP%\pocket-plane\` (Git Bash: `$TEMP/pocket-plane/`): per-run output only, named after the project, never the agent tool: `briefs/`, agent reports `<name>.md`, archived evidence `verify-*/`. Storage Sense may clear `%TEMP%`; nothing here is needed to continue. |
| Worktrees | `main` only (slot 1: dev 4110/4111, verify 4112; test agents on `main` use 4113). Leftover untracked dirs the DM may delete: `~/.herdr/worktrees/pocket-plane/build-party-loot`, `build-entities-feedback`; `data/verify-*` test data in the main checkout. |

## 2. Next, in order

**Sprint 1 (post-MVP), DM decision #177: [sprint-1.md](sprint-1.md).** Three tracks in parallel: **P** polish (R1–R5), **D** combat depth (`combat-extras`, CBTX), **S** player-owned sheets (`character-sheet-full`, CHARX).

1. Spec phase, all three at once: one spec agent per track (`spec/polish-r`, `spec/combat-extras`, `spec/character-sheet-full`). P revises the owning MVP specs; D and S expand their stubs from `_template.md` into full specs (claim, `status: claimed → draft → in-review`). Settle the D ↔ S boundary (temp HP, death saves, conditions on the sheet) before the gate.
2. One review agent per spec (or one across all three), fixes applied by the authors.
3. **DM spec gate**: scope of D and S, every pick, the R1 / R4 / R5 questions. Then consolidate data-model / protocol, number ADRs, merge the spec branches.
4. Builds in parallel per sprint-1's hotspot rules: P fixes first where they touch combat code; schema changes by shared branch first; D after P's combat fixes; S alongside.
5. Walkthroughs per feature, then a session-sim regression on final `main`, then **pause and recap with the DM** (sprint 2 candidates in sprint-1 §Gates; fog of war goes with battlemap props + structure).

Lessons from the playtest pass (2026-10-14):
- Run the **full** `bun run e2e` (all bundles) before every UI merge, not only the feature's own e2e. A layout change in one branch broke another feature's e2e on `main` once (#175).
- Builders ask for shared files via **cross-session messages** (`shared change needed: …`). Check the other active branches' diffs (`git -C <wt> diff --name-only main...HEAD`), grant with `SendMessage` to the sender's `from` address, and record the lock in status.md.
- Specs can promise something out of scope (P4 "mid-combat joiners" vs tier-A "add combatants"): the spec agent flags it; bring it to the DM rather than widening scope silently.
- A builder's "check green" can hide a flake; when a full suite fails, run it on `main` too before blaming the branch. CON-44 / FR-FIX-05 SQLITE_BUSY was a real bug (statements finalized only by GC), fixed in #175.
- Windows `jq` ends lines with CRLF: pipe IDs through `tr -d '\r'` (the tools do this).
- Builders' own permission check may refuse shared-file edits even when the orchestrator approved; only the DM's explicit OK unblocks it (never route the edit through another agent).
- Never `cd` into a worktree from the orchestrator shell (use `git -C` or a subshell): a held cwd blocks worktree removal. If `worktree remove` fails half-way, the folder is left empty: `rmdir` it, then `git branch -d`.
- Write the server pane id into a test brief in the same shell command that created the pane (`$srv` is lost between calls); a `{{SRVPANE}}` placeholder + `sed` works.
- Doc-only merge conflicts in `docs/protocol` / `docs/data-model` are routine when branches mark rows "built"; resolve by keeping both rows' built state.

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
