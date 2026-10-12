# Decisions log

Append-only. One line per decision. Written by the integrator at merge ([process](process.md#roles)).

## Kickoff

| # | Decision | Rationale | ADR |
|---|---|---|---|
| 1 | Runtime is Bun | Fast startup and tests; one tool for run/test/bundle | [0001](architecture/adr/0001-tech-stack.md) |
| 2 | Server is Hono: RPC for CRUD, native WebSocket for live events | Typed client from server routes; lightweight | [0001](architecture/adr/0001-tech-stack.md) |
| 3 | Client is Vite + React + Zustand + Tailwind + shadcn/ui | Mainstream, fast dev loop, minimal styling effort | [0001](architecture/adr/0001-tech-stack.md) |
| 4 | Map canvas is react-konva | React-friendly 2D canvas with layers and hit-testing | [0001](architecture/adr/0001-tech-stack.md) |
| 5 | DB is SQLite via Drizzle (`push` in dev, `generate` at release) | Single file, local hosting, typed schema, fast iteration | [0001](architecture/adr/0001-tech-stack.md) |
| 6 | zod at all boundaries | One validation layer shared by client and server | [0001](architecture/adr/0001-tech-stack.md) |
| 7 | Dice via `@dice-roller/rpg-dice-roller` | Mature notation support; no custom parser | [0001](architecture/adr/0001-tech-stack.md) |
| 8 | Images via `sharp` | Fast derivative generation | [0001](architecture/adr/0001-tech-stack.md) |
| 9 | Tests: `bun test` unit/integration, thin Playwright E2E | Fast default; E2E only for critical flows | [0001](architecture/adr/0001-tech-stack.md) |
| 10 | Single package, path aliases, no workspaces | Less tooling overhead for a one-table app | [0002](architecture/adr/0002-single-package.md) |
| 11 | Hosted on DM's machine at game time, via cloudflared tunnel | No cloud cost; only needed during sessions | [0003](architecture/adr/0003-local-hosting.md) |
| 12 | Campaign is the top-level scope; every record belongs to one | Simple tenancy; clean isolation between campaigns | [0004](architecture/adr/0004-tenancy-auth-permissions.md) |
| 13 | No user accounts; DM secret + per-player links bound to a name | Known group; accounts are overhead | [0004](architecture/adr/0004-tenancy-auth-permissions.md) |
| 14 | Permissions via two clients + minimal server ownership checks; no ACL | Only two roles exist; ACL framework is overkill | [0004](architecture/adr/0004-tenancy-auth-permissions.md) |
| 15 | Server-authoritative: intents → validate → mutate → broadcast per-record events | One source of truth; simple conflict model | [0005](architecture/adr/0005-server-authoritative-sync.md) |
| 16 | Events pass a visibility filter (DM all; players filtered) | Secrets never reach player clients | [0005](architecture/adr/0005-server-authoritative-sync.md) |
| 17 | Reconnect = request snapshot | Simpler than event replay | [0005](architecture/adr/0005-server-authoritative-sync.md) |
| 18 | Relational SQLite; JSON columns only for document-shaped leaf data | Queryable, migratable; avoid blob state | [0006](architecture/adr/0006-persistence.md) |
| 19 | Runtime session state lives in DB and survives crashes | Crash mid-session must not lose the table | [0006](architecture/adr/0006-persistence.md) |
| 20 | Laptops only; no touch/mobile | Known users, known devices | [0007](architecture/adr/0007-product-scope.md) |
| 21 | No dynamic lighting, freehand drawing, audio or extensions | Scope control; AoE props cover the drawing need | [0007](architecture/adr/0007-product-scope.md) |
| 22 | Full 5e character sheet from the start *(superseded by #37)* | Players need a complete sheet to replace existing tools | [0007](architecture/adr/0007-product-scope.md) |
| 23 | System is D&D 5e 2014 SRD; Open5e import first, 5etools JSON later *(import post-MVP, #36)* | Table's system; SRD licence is clear | [0007](architecture/adr/0007-product-scope.md) |
| 24 | Parallel worktree dev: env-driven ports/paths, fixtures, no shared state | Many agents must run and test concurrently | [0008](architecture/adr/0008-parallel-dev-isolation.md) |
| 25 | Obsidian vault not ported; retired gradually | Migration cost outweighs value; optional importer later | [0007](architecture/adr/0007-product-scope.md) |
| 26 | MVP visuals: dark only, shadcn defaults; BG2-style theme post-MVP | Function first; theme later without rework | [visual-direction](design/visual-direction.md) |
| 27 | ADRs grouped one per decision area, not one per bullet | Fewer, more skimmable ADRs | — |
| 28 | Cross-cutting features (live sync, assets) written as normal specs, first wave | One template for all; ordering via roadmap | [roadmap](roadmap.md) |
| 29 | Claim status lives in spec front matter, not a shared table | Avoids merge conflicts between worktrees | [AGENTS.md](../AGENTS.md#4-claiming-a-feature) |

## MVP redefinition

| # | Decision | Rationale | ADR |
|---|---|---|---|
| 30 | DM (human) is the spec reviewer; no reviewer agent | DM owns the product decisions | [process](process.md#roles) |
| 31 | MVP = playable session simulation (roleplay, story, combat) | Get a usable product in hand early and iterate | [0014](architecture/adr/0014-mvp-scope.md) |
| 32 | MVP character sheet = basics: AC, HP, initiative, one weapon attack (shortsword 1d6 may be hardcoded) | Enough for a fight; full sheet stays the target | [0014](architecture/adr/0014-mvp-scope.md) |
| 33 | MVP combat = one enemy kind *(superseded by #63: multiple kinds)*, single weapon attack each; initiative, HP, damage, rolls | Minimum to run a fight | [0014](architecture/adr/0014-mvp-scope.md) |
| 34 | MVP scenes = map, grid, pan/zoom, tokens, ruler, scene switching | Town + battlemap is the session's spine | [0014](architecture/adr/0014-mvp-scope.md) |
| 35 | MVP party reward = shared party loot log (form not fixed to gold) | Need to see a reward given to the party | [0014](architecture/adr/0014-mvp-scope.md) |
| 36 | Deferred: compendium import, fog, AoE props, hidden tokens *(superseded by #76)*, world builder (incl. location ↔ scenes), full sheet, encounter builder/CR math *(superseded by #55)*, conditions | Not needed for the session simulation | [0014](architecture/adr/0014-mvp-scope.md) |
| 37 | Full 5e sheet "from day one" superseded; full sheet remains the target, model must not block it | Speed to a usable product | [0014](architecture/adr/0014-mvp-scope.md) supersedes part of [0007](architecture/adr/0007-product-scope.md) |
| 38 | MVP fixtures: one player, one enemy, town + battlemap scenes; teardown/rebuild | Fast, repeatable test setup is a working goal | [0014](architecture/adr/0014-mvp-scope.md) |
| 39 | Player-ready indicator deferred; MVP assumes immediate asset load | MVP runs on one machine, so load time is negligible; real readiness handling needed once remote | [0014](architecture/adr/0014-mvp-scope.md) |
| 40 | Props (status rings, AoE markers) post-MVP; canvas designed to accept them | Not needed to play; known requirement | [0014](architecture/adr/0014-mvp-scope.md) |
| 41 | Notes (token-linked, player notes) post-MVP; tokens designed to open windows | Known requirement; not needed to play | [0014](architecture/adr/0014-mvp-scope.md) |
| 42 | Damage cards in MVP (trial) | Removes "read the damage out loud"; DM will judge in use | [0014](architecture/adr/0014-mvp-scope.md) |
| 43 | Every roll supports automated or manual (physical dice) entry, for DM and players | DM and players sometimes want real dice | [0014](architecture/adr/0014-mvp-scope.md) |
| 44 | One play page: canvas base + floating windows (Roll20-style) | Replaces six-window setup; avoids rework when notes/props arrive | [0014](architecture/adr/0014-mvp-scope.md) |
| 45 | In-process domain event bus from the start; WS broadcaster is a listener | Live sync needs events anyway; reactions (concentration, durations) plug in without rework | [0016](architecture/adr/0016-domain-events-pending-actions.md) |
| 46 | Rules create persisted pending actions, not silent mutations; game-time triggers only, no wall-clock scheduler | Keeps DM in control; crash-safe; simple | [0016](architecture/adr/0016-domain-events-pending-actions.md) |
| 47 | Damage cards, reminders and prompts are one concept: notification with history and optional action | Like toasts with a feed; one mechanism for all prompts | [0016](architecture/adr/0016-domain-events-pending-actions.md), [notifications](specs/notifications.md) |
| 48 | Player lands on the active scene; opens windows freely; window layout/preferences persisted per player | Fast entry; each player keeps their own setup | [0014](architecture/adr/0014-mvp-scope.md) |

## Feature tiers

| # | Decision | Rationale | Ref |
|---|---|---|---|
| 49 | Feature tier list (S/A/B/C/D/F) is the source of truth for scope | DM-ranked, quick to scan | [feature-tiers](feature-tiers.md) |
| 50 | Map batch: S = snap, token sizes, ping + pull view, laser pointer, lock map, labels, DM control/ownership; A = HP bar, condition icons, layers, doors/walls; B = current-turn highlight, path measurement | DM ranking | [feature-tiers](feature-tiers.md#1-map-and-tokens) |
| 51 | Tier B = simple version, not MVP, discuss when needed (include if near-free) | DM definition | [feature-tiers](feature-tiers.md#legend) |
| 52 | Combat batch: S = one-click monster initiative, monster health band; A = conditions, concentration, durations, temp HP, death saves, reinforcements, hidden combatants; B = reorder initiative, hit/miss hint, combat summary; C = legendary/lair, reactions | DM ranking | [feature-tiers](feature-tiers.md#2-combat) |
| 53 | Attack flow Shieldmaiden-style: click attack, Shift adv / Ctrl dis; apply card with normal/half/none/double + manual override of any value | Matches DM's current workflow | [combat-tracker](specs/combat-tracker.md#2-scope) |
| 54 | Capture rich combat/roll facts from MVP for later stats (damage dealt/taken/healed, weapon, overkill, all rolls) | Players love stats; can't compute retroactively without the data | [stats](specs/post-mvp/stats.md) |
| 55 | Encounter builder with CR difficulty is tier S (MVP) | Needed to build the first MVP encounter | [combat-tracker](specs/combat-tracker.md#2-scope) |
| 56 | Character/dice batch: S = adv/dis on any roll; A = roll from sheet, inline rolls, macros, 3D dice, portrait strip; B = roll requests, hidden DM rolls, spell slots, party summary; C = whispers, encumbrance, rests; D = inspiration; F = D&D Beyond import | DM ranking | [feature-tiers](feature-tiers.md#3-character-sheet-and-dice) |
| 57 | MVP rolls are public only *(superseded by #71)* | Hidden rolls tier B, whispers tier C | [dice-roll-log](specs/dice-roll-log.md) |
| 58 | Play shell gets its own MVP spec | One play page needs an owner for windows, layout persistence, landing | [play-shell](specs/play-shell.md) |
| 59 | Stats via robust append-only domain event log, computed retroactively; stats UI later | Flexibility: new stats work on past sessions | [0016](architecture/adr/0016-domain-events-pending-actions.md), [stats](specs/post-mvp/stats.md) |
| 60 | Notes/world/party batch: A = handouts, wikilinks+backlinks, party inventory, gold ledger, player NPC directory, command palette (A–B); B = journal sections, map pins, shared notes, session recap; C = quest log, calendar; C–D = chat (only within game log); D = random tables | DM ranking | [feature-tiers](feature-tiers.md#4-notes-handouts-world-and-party) |
| 61 | Roll log designed as a typed game log so text/pasted descriptions can join later | Roll20-style chat-in-log, no separate chat | [dice-roll-log](specs/dice-roll-log.md) |
| 62 | DM tools batch: S = scene list/folders/duplicate, multi-step undo, multiple enemy kinds; A = background scene prep, pause screen, homebrew monster editor, Open5e import, token art library; B = stat block view, rules reference, shortcuts; C = view as player; D = backup UI; F = link revocation | DM ranking | [feature-tiers](feature-tiers.md#5-dm-tools) |
| 63 | MVP encounters support multiple enemy kinds | Tier S | [combat-tracker](specs/combat-tracker.md) |
| 64 | Event log is MVP (undo depends on it); undo via compensating events (suggested, details open) | Multi-step undo is tier S | [0016](architecture/adr/0016-domain-events-pending-actions.md) |
| 65 | No player-link revocation; no backup UI | Trusted table; SQLite file copy suffices | [campaign-management](specs/campaign-management.md) |
| 66 | Undo is DM-only and strict LIFO (one step at a time, no cherry-picking) | Simple mental model; players just redo actions manually | [0016](architecture/adr/0016-domain-events-pending-actions.md) |
| 67 | Undo is basic: combat log entries only (damage/healing applied); not rolls, token moves or scene edits | Rolls are facts; moves are trivially redone by hand | [0016](architecture/adr/0016-domain-events-pending-actions.md) |
| 68 | Movement is Owlbear-style free drag with snap; no rules enforcement; players move own tokens freely outside combat | Matches current table; rules stay with people | [scenes-map](specs/scenes-map.md) |
| 69 | Players can always move tokens they control (in or out of combat); moves are not recorded in the event log | No value in move history; less log noise | [scenes-map](specs/scenes-map.md), [0016](architecture/adr/0016-domain-events-pending-actions.md) |
| 70 | Initiative/turn changes not undoable; next/previous turn suffices | Matches Shieldmaiden | [0016](architecture/adr/0016-domain-events-pending-actions.md) |
| 71 | BG2-style game log in the play view, with DM per-category public/hidden tickboxes changeable live (MVP) | Keeps combat fair; replaces broken Shieldmaiden feature; supersedes "MVP rolls public only" (#57) | [dice-roll-log](specs/dice-roll-log.md) |
| 72 | Table-specific batch: A = live leaderboard/overkill, session awards; B = kill feed, trophy case, dice luck; D = auto recap from event log; F = live AI follow-along, combat rewind, external log stream | DM ranking | [feature-tiers](feature-tiers.md#6-table-specific) |
| 73 | Player rolls always public; DM category toggles cover DM/monster rolls only | Fairness; players see their own table | [dice-roll-log](specs/dice-roll-log.md) |
| 74 | DM confirms every attack via a popup: hit/miss computed vs target AC, damage modifiers, manual fudge of any value | Matches Shieldmaiden flow + fudging | [combat-tracker](specs/combat-tracker.md#2-scope) |

## Prep and sources

| # | Decision | Rationale | Ref |
|---|---|---|---|
| 75 | Scenes prepped in the UI: upload map, grid calibration, drag tokens, rename, pick token art, hide/reveal button (MVP) | DM's real prep workflow; fixtures stay for tests | [scenes-map](specs/scenes-map.md) |
| 76 | Hidden tokens move into MVP (Owlbear-style hide button); hidden combatants follow | DM pre-places hidden enemies | [scenes-map](specs/scenes-map.md) |
| 77 | DM pre-places encounter tokens; starting an encounter does not place tokens | Matches current Owlbear prep | [combat-tracker](specs/combat-tracker.md) |
| 78 | No session tracking; encounters (start/end) are the unit of combat history | DM doesn't need sessions; recaps are story | [0013](architecture/adr/0013-session-journal-scope.md) |
| 79 | Sources: Open5e (A), homebrew files (A), Griffon's Saddlebag items with partial mechanics (B), 5etools as separate project (C) | DM's content sources | [compendium](specs/post-mvp/compendium.md), [0015](architecture/adr/0015-source-adapters-fixtures.md) |
| 80 | Custom NPCs built from SRD monster or existing NPC; custom actions auto-roll vs selected target(s); multi-target select (A) | Shieldmaiden-style prep | [compendium](specs/post-mvp/compendium.md), [combat-extras](specs/post-mvp/combat-extras.md) |
| 81 | Every capability is a server command; UI, fixtures, importers and future agents are callers | Keeps future agent features cheap (SOLID) | [overview](architecture/overview.md#cross-cutting-rules) |
| 82 | Notes will be markdown + wikilinks (Obsidian-compatible) | DM's agent note-grooming workflow carries over | [world-builder](specs/post-mvp/world-builder.md) |
| 83 | Fog of war not MVP; first item after MVP | Hide button covers the first playtest | [scene-tools](specs/post-mvp/scene-tools.md) |
| 84 | One shared, source-agnostic interface for adding creatures to an encounter (SRD, imported, custom, duplicated, fixture) | Uniform prep; compendium plugs in later without changing combat | [0009](architecture/adr/0009-entity-content-model.md), [combat-tracker](specs/combat-tracker.md) |
| 85 | Custom creature form modelled on Shieldmaiden + duplicate (MVP); picker search only if near-free | DM's preferred prep tool | [combat-tracker](specs/combat-tracker.md) |
| 86 | Build agents test and iterate in a browser (DM + player contexts) against disposable fixture bundles | Visual, multi-client app; fast feedback | [0017](architecture/adr/0017-agent-verification-fixture-library.md) |
| 87 | Fixtures are simple and clear: shape maps on white, shape-on-circle tokens, SRD monsters, stock items | Readable, licence-safe, quick to verify | [0017](architecture/adr/0017-agent-verification-fixture-library.md) |

## Entity model

| # | Decision | Rationale | Ref |
|---|---|---|---|
| 88 | Creature definitions vs instances. Imported (SRD) definitions read-only; custom definitions derived via prefilled form; edits propagate to encounters and instances | Uniform handling; one place to fix a creature | [0009](architecture/adr/0009-entity-content-model.md) |
| 89 | Instances never edit stats: only name, play state, modifiers. Ctrl-D duplicates an instance. Effective stats = definition + modifiers | Inline editing would blow up complexity | [0009](architecture/adr/0009-entity-content-model.md) |
| 90 | Compendium re-import safety: imported entries immutable, edits via derived customs | Follows from #88 | [0010](architecture/adr/0010-compendium-design.md) |
| 91 | Derived definitions are independent copies; "copy from base" only prefills the form | Custom creature is its own thing | [0009](architecture/adr/0009-entity-content-model.md) |
| 92 | PCs follow definition/instance split; PC HP lives on the character | One model; sheet always shows true HP | [0009](architecture/adr/0009-entity-content-model.md) |
| 93 | Storage: entity table + per-kind zod-validated JSON stat block; play state/modifiers relational | Hybrid option A | [0009](architecture/adr/0009-entity-content-model.md) |
| 94 | Import = fixed pipeline core + bespoke adapter per source; no generic adapter framework | Unknown sources; avoid overengineering | [0015](architecture/adr/0015-source-adapters-fixtures.md) |
| 95 | Three data origins: imported content (pipeline), test fixtures (ADR-0017), app-generated (UI → commands) | Each has a different lifecycle | [0015](architecture/adr/0015-source-adapters-fixtures.md) |
| 96 | Known adapters: Open5e SRD (first), AI paste, homebrew, Griffon's Saddlebag; 5etools separate project; character import via once-off scripts later | DM's sources | [0015](architecture/adr/0015-source-adapters-fixtures.md) |
| 97 | Setup fixtures are scripts of server commands; fixtures are test data only | Exercise real code; no unreachable states | [0017](architecture/adr/0017-agent-verification-fixture-library.md) |
| 98 | Minimal import pipeline core in MVP; SRD fixture creatures load through it as read-only imports | Read-only vs custom testable from day one | [0015](architecture/adr/0015-source-adapters-fixtures.md) |
| 99 | AI paste is a form-filling time-saver: prefills the creature/item form, DM saves a custom; not an import | Avoids a fake "source" with no re-import | [0015](architecture/adr/0015-source-adapters-fixtures.md) |
| 100 | MVP characters come from fixtures; character builder after MVP | DM can play with test characters for a while | [character-sheet](specs/character-sheet.md), [levelling](specs/post-mvp/levelling.md) |

## Workflow

| # | Decision | Rationale | Ref |
|---|---|---|---|
| 101 | Work is run by a Herdr orchestrator agent acting as integrator; focused spec/build/test/review agents in worktrees | DM reviews; agents keep context small | [orchestrator prompt](agents/orchestrator-prompt.md), [process](process.md#roles) |
| 102 | Browser testing is done by separate, short-lived test agents; builders never run long browser sessions | Protects builder context | [orchestrator prompt](agents/orchestrator-prompt.md#4-context-management) |
| 103 | Specs written just in time per build phase (Foundation, Scenes, Combat, Reward); next phase specced while current builds; data model + protocol are living docs | Faster to a usable product; keeps a review + consolidation step per phase | [roadmap](roadmap.md#build-order-mvp), [orchestrator prompt](agents/orchestrator-prompt.md#6-phases-and-gates) |
| 104 | Line endings normalised to LF (`.gitattributes eol=lf`) | Stop CRLF churn across worktrees | — |
| 105 | Orchestrator runs sub-agents as `opencode`, max 4 working agents at once | DM choice at kickoff | [orchestrator prompt](agents/orchestrator-prompt.md#3-herdr) |
| 106 | MVP character sheet basics (AC, HP, initiative bonus, one weapon attack) are stored values, not derived; full-sheet derivation decided later | Least work for 4 fields; doesn't block derived-with-overrides later | [0012](architecture/adr/0012-character-derived-values.md) |
| 107 | Spec index grouped by build phase instead of the old spec waves | Matches just-in-time specs per phase (#103) | [spec index](specs/README.md) |

## Phase 1 gate

| # | Decision | Rationale | Ref |
|---|---|---|---|
| 108 | Several campaigns from day one; one active campaign per server, DM switches | DM runs a few campaigns | [campaign-management](specs/campaign-management.md) |
| 109 | No player removal in MVP; add + rename only | Removal would amount to revoke/kick (tier F) | [campaign-management](specs/campaign-management.md) |
| 110 | Tooling: TypeScript `tsc --noEmit`, Biome, Playwright MCP for test agents, committed SVG fixture images rasterised with sharp | Not in ADR-0001; DM approved | [AGENTS.md](../AGENTS.md) |
| 111 | Agents' picks accepted for all blocking foundation OQs (SYNC-01/03/04/07/09, CAMP-01/03/10, FIX-02/08/09/12) | DM accepted at gate | [gate](agents/gate-phase1.md) |
| 112 | DM secret from env only, never stored | One source of truth | [campaign-management](specs/campaign-management.md) |
| 113 | Imported definitions (SRD, 5etools, Open5e) are global; custom definitions (custom NPCs) per campaign | Same reference content across campaigns | [0018](architecture/adr/0018-global-imported-content.md) |
| 114 | Gate defaults (no DM objection): DM-only in-memory presence list; rename player and campaign; test-only sync probe record; fixture CLI refuses to load while the server runs | Near-free; proves visibility filter in Phase 2; avoids stale clients | [live-sync](specs/live-sync.md), [campaign-management](specs/campaign-management.md), [fixtures-adapters](specs/fixtures-adapters.md) |
| 115 | Domain event listeners run synchronously, same process, after commit | One table; simple ordering (events reach the sender before its ack) | [0021](architecture/adr/0021-sync-protocol-conventions.md), [0016](architecture/adr/0016-domain-events-pending-actions.md) |
| 116 | Build conventions approved (AGENTS.md §9); `env:init` writes `PP_DATA_DISPOSABLE=1` and a random dev DM secret per worktree | Worktrees work immediately; real installs never set the flag | [AGENTS.md](../AGENTS.md#9-build-phase-conventions) |
| 117 | ADRs 0019–0022 accepted (auth credentials, single active campaign, sync protocol conventions, deterministic seams); foundation specs complete | Phase 1 gate | [ADR index](architecture/adr/README.md) |
