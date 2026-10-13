# Continue: orchestrator session handover

Start Claude Code (or opencode) in `C:\Repos\pocket-plane` inside Herdr and say:

> Read `docs/agents/continue-session.md` and continue as the orchestrator.

---

You are the **orchestrator and integrator** for Pocket Plane. Your role, rules, brief templates and phase plan are in [orchestrator-prompt.md](orchestrator-prompt.md). Read it first, then this file, then [status.md](status.md) and [feedback-phase3.md](feedback-phase3.md). Follow [AGENTS.md](../../AGENTS.md) §1: short replies; 1–2 questions at a time, each with options and your pick.

**Working mode (DM, #141):** run long autonomous stretches. Merge, fix and sequence on your own; settle technical questions yourself and log them. Come back to the DM only when blocked: product decisions, phase gates, ADR acceptance, new dependencies, anything destructive.

## 1. Where we are (2026-10-13, evening)

| Area | State |
|---|---|
| Phases 0–4 | **Built and merged on `main`**: Foundation, Scenes, Combat, party-loot (Reward), the full DM-feedback pass (F1–F9 + #149 checks/saves: diagonal 5/10/5, turn alert + UI sounds, movement tracker, token shapes, Out/Down overlays, map targeting + multi-target, box select, physical-dice visibility), playtest polish incl. map-first layout, and Phase 4 hardening. ~723 tests; `check`, `build`, `e2e` green. |
| Verification | Every feature walkthrough PASS (evidence `%TEMP%\opencodeerify-*`). Session-sim regression 12/12 (#162). Crash-recovery walkthrough 12/12 with `PP_TEST_CRASH` + `bun run state:digest` (#166). Snapshot sizes: realistic heavy session DM 62% / players 47% of CON-44 (#164). |
| Specs / ADRs | All MVP specs `complete`. ADRs 0001–0032 accepted (0030 UI sounds, 0031 token-move hooks, 0032 ability derivation). |
| Decisions | Up to #167 in [decisions-log](../decisions-log.md). |
| Agents | Claude Code (`--kind claude -- --permission-mode auto`, `--strict-mcp-config` except test agents; #148). Helper scripts in `%TEMP%\opencode\` (`mkwt.sh`, `startagent.sh`, `poll.sh <agent…>`). |
| Worktrees | `main` (slot 1: dev 4110/4111, verify 4112). Leftover untracked dirs the DM may delete: `~/.herdr/worktrees/pocket-plane/build-party-loot`, `build-entities-feedback`. |

## 2. Next, in order

1. Merge `fix/reconnect-toasts` (FR-NOTE-15 pending summary / sticky card after a DM reconnect; friendly wording for REST network failures) after its tests; tiny re-check if UI changed.
2. **Phase 5 MVP acceptance (DM go, #167):** fresh `test-mvp` agent on final `main`: full session simulation ([vision](../vision.md#mvp-a-playable-session-simulation)) incl. party loot + the crash test; brief template = `%TEMP%\opencoderiefs	est-session-2.md` + `test-crash.md`.
3. Send the DM a **playtest script** (bundle `session-sim`, `bun run fixtures:reset-load session-sim --profile verify`, `bun run start --profile verify`, DM URL + secret + player links, what to click), then collect feedback.
4. Afterwards: post-MVP planning with the DM (fog of war first in line; tier A backlog: DM-added sounds, battlemap props, group move, skills, full PC/NPC editing + player-filled sheets).

Lessons from this session:
- Builders' own permission check may refuse shared-file edits even when the orchestrator approved; only the DM's explicit OK unblocks it (never route the edit through another agent).
- Never `cd` into a worktree from the orchestrator shell (use `git -C` or a subshell): a held cwd blocks worktree removal.
- Write the server pane id into a test brief in the same shell command that created the pane (`$srv` is lost between calls).
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
- **Always pass `--workspace`** (without it Herdr once created worktrees in another repo).
- If `agent start` says `agent_pane_busy`: close that pane, split a new one, wait, retry.
- Read-only reviewers: a new tab in `<ws>` (`herdr tab create --workspace <ws> --label reviews --no-focus`), no worktree.

**Prompting**
- Write each brief to `%TEMP%\opencode\briefs\<name>.md`, then send one line: `herdr agent prompt <name> "Read your brief at <path> and follow it exactly."` (claude kind; the opencode-era ASCII flattening is not needed). `--wait` times out while the agent works; check `herdr agent get` instead.
- PowerShell here-strings: `@'…'@` (literal) for briefs; with `@"…"@` every `$x` interpolates — a hashtable once printed as "System.Collections.Hashtable". Never put `\"` inside a double-quoted string (parse error); use single quotes.
- Check `herdr agent get <name>` ~10 s after prompting; if still `idle`, the prompt stalled — resend.
- Poll: loop `herdr agent list` every 30 s, cap ~14 min, stop when any watched agent leaves `working`. `blocked` = a question dialog: read it with `herdr agent read <name> --source visible`; answer with `send-keys` (enter = recommended option) only if it's technical; product questions go to the DM.
- Read results when idle/done: `herdr agent read <name> --source recent-unwrapped --lines 40`.
- Long outputs: agents write to `%TEMP%\opencode\<name>.md`. Hand review findings to a revision agent by copying them into its worktree as `.review.md` (it deletes it before committing).
- Agent kind is **claude** since #148 (opencode before). Every claude agent loads `.mcp.json` = 3 Playwright MCP servers each; builders, spec and review agents start with `--strict-mcp-config` so they load none. Close a finished agent's pane promptly (its MCP children go with it).

**Builders**
- Brief = orchestrator-prompt §5 builder template plus: own paths (`src/server/features/<f>/`, `src/shared/<f>/`, `src/client/{common,dm,player}/features/<f>/`, `fixtures/units/<f>/`, own bundle, `e2e/<f>.e2e.ts` with a `// e2e-bundle: <name>` header), append-only registries (AGENTS §9.9), and "any other shared file: STOP and report `shared change needed: <path> — <what> — <why>`".
- Approve shared changes by **sequencing**: one branch holds the lock (record it in status.md), the others wait or work on non-shared slices. Builders may write the data-model/protocol rows for what they build.
- Window geometry: protocol §18/§24 is authoritative; shell layout tests are registry-driven (fit at 1280×720, product no-overlap at 1600×900, test windows among themselves).
- Agents must never start long-running servers from their own shell (hangs on Windows) and never run browser sessions; builders report "ready for walkthrough".

**Test agents (browser walkthroughs)**
- Run in the builder's worktree, new tab, plus a **dedicated server pane** (split from the agent pane). Build the client once yourself first (`bun run build` in that worktree, after `git merge main`).
- Template (fill `{{…}}`): see §5 below. Give each test agent its own `PP_PORT` (e.g. base+3 of the worktree's slot), `PP_DATA_DIR=data/verify-<name>`, `PP_PROFILE=verify`, `PP_TEST_MODE=1` when the walkthrough uses Probes / test windows.
- "Drop connection" reconnects in ~0.5 s; agents hold a player offline with Playwright `setOffline` or close the socket to observe the banner. `ERR_CONNECTION_REFUSED` during deliberate outages is expected, not a failure.
- After a PASS: copy `<worktree>\.verify\*` to `%TEMP%\opencode\verify-<task>\` before removing the worktree.

**Merging and cleanup (always)**
1. `git -C <wt> status --short`, `git log --oneline main..HEAD`; in the worktree `git merge main`, then `bun run check` (+ `bun run e2e` for UI changes).
2. On `main`: `git merge --no-ff -q -m "Merge <branch> (…)" <branch>`.
3. Close every pane of the worktree's workspace (`herdr pane list --workspace <id>` → `pane close`), wait 3 s, `git worktree remove --force <path>`, `git branch -d <branch>`, `git worktree prune`.
4. Update status.md, decisions-log, spec index, glossary as the integrator; number proposed ADRs at acceptance (rename file, fix links with `git grep`, add to the ADR index).
5. Known flake: loader tests EBUSY on Windows temp-dir teardown — fixed with retries; if it reappears, it's that.

## 4. PowerShell and file gotchas

- Console shows `—`/`§`/`→` as mojibake; the files are fine. A `.Replace()` with those characters typed in a command won't match — use the Edit tool for lines containing them.
- Write files with `[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))`, LF endings; keep `docs/protocol/README.md` LF.
- `[regex]::Replace`: write `${1}` when digits follow a backreference.
- Don't name a helper function `R`. Format new JSON/TS files with `bun x biome format --write <file>`.
- Playwright MCP servers `pw-dm`, `pw-player-1`, `pw-player-2` are in `.mcp.json` (claude, enabled by `.claude/settings.json`) and `opencode.json`; agents load MCP servers at start.

## 5. Test-agent brief template

```
You are verifying ONE walkthrough for Pocket Plane in this worktree (branch {{BRANCH}}). Do NOT fix code, do NOT edit tracked files, do NOT commit.
Read: AGENTS.md section 9.2, 9.3, 9.5, 9.6; docs/specs/{{SPEC}}.md section 13 (the walkthrough) and the FRs it references; docs/architecture/adr/0017-agent-verification-fixture-library.md.
ISOLATION: in EVERY PowerShell command first set: $env:PP_PROFILE='verify'; $env:PP_PORT='{{PORT}}'; $env:PP_DATA_DIR='data/{{DATADIR}}'{{EXTRAENV}}. Use only port {{PORT}}. Never touch other data folders. The client is already built (dist/client); do NOT run bun run build.
1. Reset + load: bun run fixtures:reset-load {{BUNDLE}} (with the env above). Note the printed DM URL, DM secret and player link(s).
2. Start: NEVER from your own shell tool (it hangs on Windows). Use your Herdr pane {{SRVPANE}}: herdr pane run {{SRVPANE}} "<env above>; bun run start"; poll http://127.0.0.1:{{PORT}}. Stop: herdr pane send-keys {{SRVPANE}} ctrl+c (hard kill: Stop-Process -Id <pid in server.lock> -Force). Logs: herdr pane read {{SRVPANE}} --source recent-unwrapped --lines 80.
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
