# Architecture Decision Records

One ADR per decision area. Accepted ADRs are binding; change them only via a superseding ADR.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-tech-stack.md) | Tech stack | accepted |
| [0002](0002-single-package.md) | Single package, path aliases | accepted |
| [0003](0003-local-hosting.md) | Local hosting via cloudflared | accepted |
| [0004](0004-tenancy-auth-permissions.md) | Tenancy, auth and permissions | accepted; amended by 0046 (global compendium rows) |
| [0005](0005-server-authoritative-sync.md) | Server-authoritative sync | accepted |
| [0006](0006-persistence.md) | Persistence model | accepted |
| [0007](0007-product-scope.md) | Product scope and exclusions | accepted, partly superseded by 0014, 0042 (vision in; lighting stays out) |
| [0008](0008-parallel-dev-isolation.md) | Parallel dev isolation | accepted |
| [0009](0009-entity-content-model.md) | Entity content model | accepted, refined by 0035, 0038 |
| [0010](0010-compendium-design.md) | Compendium design | accepted (scope A via 0046, #207; re-import safety option i) |
| [0011](0011-cross-references.md) | Cross-reference model | proposed |
| [0012](0012-character-derived-values.md) | Character sheet: derived vs stored, homebrew overrides | accepted for MVP basics (stored), amended by 0032; full sheet decided by 0036 (C, derived with overrides) |
| [0013](0013-session-journal-scope.md) | Session outcomes / journal: MVP or post-MVP | accepted — no session tracking (sprint-9 note: on-demand recap from the event log, #339) |
| [0014](0014-mvp-scope.md) | MVP is a playable session simulation | accepted |
| [0015](0015-source-adapters-fixtures.md) | Import pipeline and source adapters | accepted |
| [0016](0016-domain-events-pending-actions.md) | Domain events and pending actions | accepted (core), refined by 0034, 0035, 0037, 0061; undo scope amended by 0039 |
| [0017](0017-agent-verification-fixture-library.md) | Agent-driven verification and fixture library | accepted |
| [0018](0018-global-imported-content.md) | Imported reference content is global; custom content per campaign | accepted; amended by 0046 (compendium entries) |
| [0019](0019-auth-credentials.md) | DM secret and player link credentials | accepted; amended by 0046 (player REST header on compendium routes) |
| [0020](0020-single-active-campaign.md) | Several campaigns, one active per server | accepted |
| [0021](0021-sync-protocol-conventions.md) | Sync protocol conventions | accepted, C refined by 0041, 0045, D refined by 0036, 0038 |
| [0022](0022-deterministic-seams.md) | Deterministic IDs, tokens and clock for fixtures and tests | accepted; fixed clock amended by 0068 for CLI loads |
| [0023](0023-asset-access-by-capability-id.md) | Asset access by capability ID | accepted; amended by 0054 |
| [0024](0024-definition-visibility.md) | Creature definitions DM-only for players; instances carry read-only display copies | accepted (refines 0009), redaction whitelist refined by 0036; refined by 0050; amended by 0056 (pets) |
| [0025](0025-play-shell-windows.md) | Feature UI as play-shell windows; layout in browser storage | accepted; placement extended by 0060 |
| [0026](0026-signal-routing.md) | Signal routing: sender stamp, DM-only pull, receiver scene filter | accepted, amended by 0033 |
| [0027](0027-notification-creation.md) | Notifications are created in the causing command's transaction | accepted (refines 0016), refined by 0034, 0035, 0037 |
| [0028](0028-token-changed-hooks.md) | Token-changed hooks keep bound instances in step | accepted (extends 0024), amended by 0031; refined by 0039 |
| [0029](0029-windowed-record-types.md) | Windowed record types: bounded snapshots for append-only logs | accepted (amends FR-SYNC-20) |
| [0030](0030-ui-notification-sounds.md) | Short UI notification sounds (turn alert) | accepted (amends ADR-0007) |
| [0031](0031-token-move-hooks.md) | Token-changed hooks also run on token moves | accepted (amends 0028), amended by 0040 |
| [0032](0032-ability-derivation.md) | Ability modifiers, proficiency bonus and save bonuses derived in MVP | accepted (amends 0012) |
| [0033](0033-signal-audience.md) | Signal audience hook: a signal type routes to everyone or DM only, or refuses the sender | accepted (amends 0026), refined by 0042 (player-list audience) |
| [0034](0034-encounter-scoped-notifications.md) | Pending combat notifications end with their encounter, per kind | accepted (refines 0016, 0027) |
| [0035](0035-combat-rule-hooks.md) | Combat rules run in the causing command's transaction | accepted (refines 0009, 0016, 0027), refined by 0038, 0043; refined by 0049 |
| [0036](0036-full-sheet-derivation.md) | Full character sheet: derived with overrides; rules data vs sheet record | accepted (decides 0012 full sheet; refines 0021 D, 0024); other-player whitelist amended by 0063 |
| [0037](0037-split-attack-damage.md) | Attack and damage as separate rolls on one damage card | accepted (#190; refines 0016, 0027); refined by 0053 |
| [0038](0038-effect-modifiers.md) | Effect modifiers: typed riders on effect rows, applied by a roll hook | accepted (#190; refines 0009, 0021 D, 0035), refined by 0043 |
| [0039](0039-fog-visibility.md) | Fog visibility: server-written `fogged` copies, scene visibility and lifecycle hook registries | accepted (#196; amends 0016 undo scope; refines 0024, 0028), refined by 0042 (per-player copies) |
| [0040](0040-token-move-guards.md) | Token move guards: a move may be refused | accepted (#196; amends 0031), refined by 0042 (dry-run hints; walls block sight) |
| [0041](0041-active-scene-window.md) | Active-scene window for tokens and scene-tool records in the DM snapshot | accepted (#196; refines 0021 C; sibling of 0029), refined by 0042 (`fog`, `view-as`) |
| [0042](0042-dynamic-vision.md) | Dynamic vision: freeform fog, per-player sight with darkvision, magical darkness, Invisible | accepted (#207, #208, #210; supersedes part of 0007; refines 0021, 0033, 0039, 0040, 0041); refined by 0047 |
| [0043](0043-rule-triggers.md) | Rule triggers: conditional class-feature riders as data, offered at the damage roll and settled at apply | accepted (#207, #209; refines 0016, 0035, 0038); visibility consequence superseded by 0049 |
| [0044](0044-3d-dice.md) | 3D dice: throws derived on each client from received roll entries | accepted (#207; amends 0001 stack); amended by 0048; amended by 0051 |
| [0045](0045-lazy-record-types.md) | Lazy record types: never in a snapshot, loaded on open with `sync.load` | accepted (#207; extends 0021 C, sibling of 0029 / 0041) |
| [0046](0046-compendium-scope.md) | Compendium: global library, campaign clones, read on demand | accepted (#207; completes 0010; amends 0004, 0018, 0019) |
| [0047](0047-party-vision.md) | Party vision, sight while dragging, 999 ft default vision | accepted (#245; refines 0042; extends 0021, 0033, 0040, 0041) |
| [0048](0048-dice-display.md) | Dice display: full-screen dice layer and roll popup | accepted (#245; amends 0044); amended by 0051 |
| [0049](0049-trigger-state.md) | Trigger state for clients and effect-changed hooks | accepted (#245; supersedes 0043's client-visibility consequence; refines 0035) |
| [0050](0050-token-creature-type.md) | Token creature type as a player-visible display copy | accepted (#245; refines 0024) |
| [0051](0051-dice-landing-line.md) | Dice landing: totals wait for the dice, popup dice in a line, tray previews | accepted (#256; amends 0044, 0048) |
| [0052](0052-static-serving.md) | Static client served precompressed with cache headers | accepted (#256) |
| [0053](0053-apply-hit.md) | Apply hit: a damage card applied in two steps | accepted (#256; refines 0037) |
| [0054](0054-compendium-rest-asset-ids.md) | Asset IDs in compendium REST bodies after the entry visibility check | accepted (#256; amends 0023) |
| [0055](0055-player-colour.md) | Player colour stored once per person, derived everywhere | accepted (#256); bullet 1 amended by 0057 |
| [0056](0056-companion-visibility.md) | Companions: the owner sees an owned creature's stats | accepted (#288; amends 0024, refines 0009, 0036) |
| [0057](0057-free-player-colour.md) | Free player colour (`#rrggbb`, validity + distance rules) | accepted (#288; amends 0055) |
| [0058](0058-feature-switches.md) | Campaign feature switches (optional features off by default; one hub rule) | accepted (#315) |
| [0059](0059-stats-read-models.md) | Stats as read models over the fact tables, filtered per viewer | accepted (#315); §4 caching refined by 0062 |
| [0060](0060-one-window-placer.md) | One placer for every window path: PCs first, then shrink, then put away | accepted (#335; extends 0025; amends #245); amended by 0064 (window memory) |
| [0061](0061-roll-requests.md) | DM roll requests as pending actions; hidden answers to DM + the target's player | accepted (#335; refines 0016, 0027; amends #73 for answers) |
| [0062](0062-stats-session-partials.md) | Campaign-wide stats from per-session partials kept in memory | accepted (#335; refines 0059) |
| [0063](0063-party-hp-visibility.md) | Party status: other players see a PC's HP, temp HP and AC | accepted (#335; amends 0036 / #178 G6) |
| [0064](0064-window-memory.md) | Window memory: the placer leaves windows you arranged alone | accepted (#339; amends 0060 decisions 2, 3, 5, 6, #310, #333) |
| [0065](0065-reminder-stronghold-records.md) | Reminders and strongholds as record families | accepted (#339; extends 0045) |
| [0066](0066-stores-holder.md) | A stronghold's Stores as a holder in the loot / inventory ledger | accepted (#339) |
| [0067](0067-command-registry.md) | One client command registry for the palette and keyboard shortcuts | accepted (#339; extends 0025, 0060 §7) |
| [0068](0068-fixture-load-clock.md) | CLI fixture loads anchor the seeded clock at load time | accepted (#339; amends 0022 for CLI loads) |
| [0069](0069-theme-switch.md) | Theme switch: one stylesheet per theme keyed on `data-slot`, no theme logic in components, no geometry change | accepted (#351; theme-system OQ-THEME-01 A) |
| [0070](0070-launcher-in-top-bar.md) | Launcher in the top bar's centre zone; work area to the bottom edge; layouts regenerated once (kit parity) | accepted (#356; kit-parity OQ-KIT-01 A; amends play-shell §7) |
| [0071](0071-spell-fx.md) | Spell FX: client-drawn map effects on effect rows (`effect.fx`), transient hit cues from an after-commit listener, filtered per connection | accepted (#373; OQ-VFX-05 A by the DM) |
| [0072](0072-agent-mcp-server.md) | Agent MCP server: a local stdio DM caller over the existing REST + WS intents, DM secret from `.env`, server found via `server.lock`, code in `src/mcp/`, registered only in the DM's own checkout | accepted (#379; agent-api OQ-AGENT-11) |

## Proposing a new ADR

- Create `proposed-<slug>.md` from the template below. Integrator assigns a number at merge.
- Status flow: `proposed → accepted | rejected`, later `superseded by NNNN`.

## Template

```markdown
# NNNN — Title

- Status: proposed
- Date: YYYY-MM-DD
- Affects: <specs>

## Context
- Why this needs deciding.

## Options
| Option | Pros | Cons |
|---|---|---|

## Decision
> Undecided. / The chosen option, in one line.

## Consequences
- What changes for specs/build.
```
