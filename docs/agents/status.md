# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 2 **phase 2 builds** (gate 2 #196; specs merged; ADR-0039 to 0041). Order: `fix/active-scene-window` → `fix/fog-core` → `fix/scn-core` → SCN slices ∥ fog server / client → `build/scene-tools-settings`; P3 polish in parallel. Then session-sim regression, 'Playtest: sprint 2 features', pause and recap.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Phase 1 | merged | — | Done (#189-#195) | DM playtest |
| Window, fog core / server, SCN core | merged | — | Done (#197) | — |
| P3 polish | `fix/p3-polish` (w32) | build-p3-polish | Fixing E1 / E2 | Retest |
| SCN structure | `build/scene-tools-structure` (w36) | build-scn-structure | Building | Walkthrough |
| SCN props | `build/scene-tools-props` (w37) | build-scn-props | Building | Walkthrough |
| SCN templates | `build/scene-tools-templates` (w38) | build-scn-templates | Building | Walkthrough |
| Fog client | `build/fog-client` | — | When a slot frees | — |
| Fog visibility (switch on) + fog-scn | `build/fog-visibility` | — | Last fog slice | — |
| SCN settings | `build/scene-tools-settings` | — | After fog-visibility | — |

## Shared-file locks

- Registries (canvas-layers, canvas-tools, move-guards, scene-hooks, visibility-hooks, token menu): append-only for all slices.
- LabelsLayer + token context menu: fix/p3-polish.
- Schema: free.

## Pending DM decisions

- None (gate 2 answered #196). DM playtest of phase 1 pending.

## Resolved locally (report at gate)

- Sprint 2 phase 1 seams S1–S7 + review rulings: `.verify/review-phase1/{seams,rulings}.md` (main checkout). N7 kinds: `toHit` / `spellToHit` new, `attack` keeps Attack + damage. Token gets a `characterId` display copy (ADR-0021/0024-safe) for FR-CBTX-50. Build plan = the reviewer's graph (`review.md` "Build order").

- Sprint 1: CON-44 headroom is tight (heavy DM snapshot 746 KB vs 768 KiB after cbtx-core). D build: snapshot only active effects; never raise a ceiling without a look.
- Sprint 1 nit (not a FAIL): Notifications window opens ~250 px tall vs spec §7 360×480 (test-polish-notes).

- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
