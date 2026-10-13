# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3 built + feedback fixes merged (#153: diagonal 5/10/5, F9 polish, own dice roller). Now: party-loot build; feedback specs in review → DM gate (2 proposed ADRs).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| party-loot | `build/party-loot` (slot 4) | `build-party-loot` | building (spec complete #152) | walkthrough → merge |
| Feedback spec pass (F1, F3, F4, F6, F7, F7.1, F8, #149 checks + saves) | `spec/feedback` | `review-feedback` | in review | DM gate: proposed-token-move-hooks, proposed-ability-derivation, OQs → consolidation → builds |
| Phase 4 hardening (crash-recovery pass) | — | — | not started | after feedback builds + party-loot (DM go) |
| Phase 5 MVP acceptance | — | — | not started | — |

Evidence archived: `%TEMP%\opencode\verify-*\` (… layout, f9, polish).

## Shared-file locks

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
