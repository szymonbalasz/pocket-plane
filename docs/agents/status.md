# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3 built. DM batch done (#148–#150). Now: feedback spec pass + party-loot spec round 2 + small fixes in parallel.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| F2 diagonal 5/10/5 | `fix/diagonal-rule` (slot 0) | — (builder closed) | code done, unit tests green | rerun check + e2e, tiny walkthrough, merge |
| F9 + polish (physical badge, safer toggle, DM Init box, Roll-as dup, Goblin log line, toasts over Initiative, e2e wait 30 s) | `fix/dice-polish` (slot 2) | `build-dice-polish` | building | walkthrough → merge |
| party-loot | `build/party-loot` (slot 4) | `build-party-loot` | building (spec complete #152) | walkthrough → merge |
| Dice library → own roller (#151) | `fix/dice-engine` (slot 3) | `build-dice-engine` | building | merge first (faster server start for everyone) |
| Feedback spec pass (F1, F3, F4, F6, F7, F7.1, F8) | `spec/feedback` | `spec-feedback` | writing | + addendum #149 (sheet checks + saves) → review → consolidation |
| Phase 4 hardening (crash-recovery pass) | — | — | not started | after feedback builds + party-loot (DM go) |
| Phase 5 MVP acceptance | — | — | not started | — |

Evidence archived: `%TEMP%\opencode\verify-*\` (… layout, f9).

## Shared-file locks

- `scripts/e2e.ts` → `fix/dice-polish` (server wait 10 s → 30 s).
- `package.json`, `bun.lock`, `src/server/commands/dice.ts` → `fix/dice-engine`.
- `src/server/db/` (loot_entry), `src/shared/events/` (loot events), party-loot rows in data-model + protocol → `build/party-loot`. Feedback core waits and rebases.

## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
