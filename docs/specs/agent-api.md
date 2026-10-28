---
title: Agent / MCP API
prefix: AGENT
status: in-review
owner: spec-agent-api
phase: post-mvp
---

# Agent / MCP API

> **Guideline:** five-minute read. Decisions [#378](../decisions-log.md) are binding. Architecture choices are in the proposed ADR [proposed-agent-mcp-server](../architecture/adr/proposed-agent-mcp-server.md).

## 1. Summary

- A local **MCP server**, run with `bun run mcp`, so the DM can create and edit campaign content from Claude Code instead of filling in forms.
- It is **just another caller** (#378 (2)). It uses the existing REST routes and WS intents with the DM secret, so every write goes through the same command, event log and visibility filter as a DM-client form. It never opens the SQLite file.
- A Claude Code **skill** turns any text or image (a Reddit homebrew post, a stat-block screenshot, "an orc on a wolf") into tool calls. It checks them with a dry run first.

## 2. Scope

- **Read tools:** the campaign, players, characters, creatures (custom and SRD) and the compendium.
- **NPC tools:** create, derive and edit a custom NPC, and add or edit rows on the NPC sheet (features, attacks, spells, items).
- **Homebrew tools:** create, edit and share compendium homebrew.
- **Character sheet tools:** field edits and row add / edit.
- **Skill** `.claude/skills/pocket-plane-content/`: text or image → tool calls, a variants recipe, a dry-run check and the mount pattern.
- `bun run mcp:call <tool> '<json>'` *(proposed)*: one tool call over real stdio, for walkthroughs and scripts.
- **No delete tools** (#378 (4)).

## 3. Goals

- An NPC, a set of variants or a homebrew item, made from a paste in under a minute, with no form.
- What players see is identical to the same edit made in the DM client: same events, same filter, live.
- Fails safe: no running server means no tool does anything, and nothing is ever written behind the server's back.

## 4. Non-goals

- Cloud, remote access or any non-loopback use (ADR-0003, ADR-0006, #378 (6)). The tunnel is never used.
- New server API: no new route, intent or record type ([ADR](../architecture/adr/proposed-agent-mcp-server.md) D4).
- Delete tools, campaign switch / create, combat, maps, dice, players and links.
- Live AI follow-along or a summariser (tier F, [feature-tiers](../feature-tiers.md)).
- Player-side agent access. The DM secret is the only credential.

## 5. User stories

**DM**
- As the DM, I want to paste a Reddit homebrew item and get a compendium entry, so I don't retype it.
- As the DM, I want "orc with shield and mace, orc with spear who runs fast, orc on a wolf" to become three derived NPCs (and a wolf mount) with sheet features, so prep takes minutes.
- As the DM, I want a dry run that lists what would be written, so I can check it before anything changes.
- As the DM, I want a clear "start the server" when I forget to, so nothing half-happens.

**Player**
- As a player, I want MCP edits to my character to appear on my sheet live, as if the DM had typed them.
- As a player, I never want to see the DM's prepared NPCs or unshared homebrew because an agent made them.

## 6. Functional requirements

**Core (slice 1)**

| ID | Requirement | Notes |
|---|---|---|
| FR-AGENT-01 | `bun run mcp [--profile p]` starts an MCP server on **stdio** that offers exactly the tools in §9. Config comes only from `parseConfig` (`.env`, `PP_PROFILE` / `--profile`, `PP_DATA_DIR`, `PP_DM_SECRET`). | ADR D1, D3 |
| FR-AGENT-02 | **Find the server**, on every tool call: read `$PP_DATA_DIR/server.lock`. Live only if `owner: "server"`, the PID is alive and `port` is set; then use `http://127.0.0.1:<port>`. | ADR D3 |
| FR-AGENT-03 | **Not running**: no lock, a dead PID, or a connection that is refused or reset → `server_not_running` "Pocket Plane isn't running (profile ‹p›, ‹data dir›). Start the server (`bun run start` or `bun run dev`)", with nothing sent. A `loader` lock → `server_busy` "A fixture load is running; try again when it finishes". `port` null → `server_busy` "The server is starting; try again". | #378 (3) |
| FR-AGENT-04 | The MCP server never creates, edits or removes the lock, the DB or the asset dir. It only reads the lock file. It imports no DB module (boundary test). | #378 (2) |
| FR-AGENT-05 | **Auth**: REST `Authorization: Bearer <PP_DM_SECRET>`; WS `hello {role: "dm", secret}`. 401 / close `4401` → `auth` "The server rejected PP_DM_SECRET from .env". After the first `auth` failure the process makes no further DM check until it restarts, so one bad `.env` can't trigger the 5-in-60-s throttle (FR-CAMP-05). 429 → `throttled` "Too many failed DM logins; wait a minute". | OQ-AGENT-06 |
| FR-AGENT-06 | **One connection per call**: open the WS, send `hello`, wait for the `snapshot`, send the intent / `sync.load`, wait for `ack` / `reject` (or make the REST call), then close `1000`. Nothing is kept between calls. Each call has a 10 s deadline → `timeout`. | OQ-AGENT-05 |
| FR-AGENT-07 | No active campaign (REST 409 / close `4409`) → `conflict` "No active campaign: open one in the DM client". Every result names `campaign {id, name}` it read or wrote. | ADR-0020 |
| FR-AGENT-08 | **Errors** are mapped per §11 table. An error result is an MCP tool error (`isError: true`) with `{code, message, issues?}`. Server `message` and `issues` are passed through unchanged. | CON-09 |
| FR-AGENT-09 | **Output**: JSON whose records are the wire shapes from `@shared` zod (`EntityRecord`, `CreatureSheetRecord`, `EntrySummary`, `EntryResponse`). A list returns ≤ 50 summaries with `q` (shared matcher `@shared/search/match`) and `cursor`. | |
| FR-AGENT-10 | **Read tools** (§9 table) read only through the DM snapshot, `sync.load` and the compendium GET routes. `players_list` uses the snapshot's `player` + `presence` records and **never returns link tokens** (so not `GET /api/players`). | |
| FR-AGENT-11 | **Writes only via the §9 table.** A test pins the set of routes / intents the MCP server can reach. None of them deletes anything. | #378 (4) |
| FR-AGENT-12 | **Dry run**: every write tool takes `dryRun?: boolean`. With it, the tool checks the input against the same `@shared` zod body the route / intent uses, plus read-side checks on a fresh snapshot / GET: the target exists and is the right kind, not imported, the name isn't taken (case-insensitive, per FR-ENT-08 / FR-CMP-24), row limits (`ROW_LIMITS`) and the base is visible. It returns `{dryRun: true, ok, issues[], would}` and sends no write. | OQ-AGENT-07 |
| FR-AGENT-13 | **Server stops mid-call**: the socket closes or the HTTP connection drops before the `ack` / response → `server_stopped` "The server stopped mid-call. The change was saved whole or not at all; start the server and read it back". Writes are never retried automatically. | ADR-0006 tx |
| FR-AGENT-14 | **Live, same as the form**: an MCP write emits the same domain events as the DM client's write. Players get them through the same visibility filter (no MCP-specific path). | #378 (2) |

**NPC tools (slice 2)**

| ID | Requirement | Notes |
|---|---|---|
| FR-AGENT-15 | `npc_create`: the `CreateEntityBody` monster branch without `derivedFromId` → `POST /api/entities`. | FR-ENT-08 |
| FR-AGENT-16 | `npc_derive {baseId, name, set?, copyText?}`. The base is a custom or imported definition: the tool reads the base's full stat block (snapshot / `sync.load`), applies `set` (a partial stat block) and sends `POST /api/entities {derivedFromId: baseId, statBlock}`. The server copies nothing (FR-ENT-09), the same as the creature form. The base is a **compendium monster entry**: `POST /api/compendium/derive-monster` (`copyText` default true fills NPC sheet Features, FR-CMP-27). | |
| FR-AGENT-17 | `npc_edit {id, set}`: `set` keys of `CharEditSet` (monster keys) → `char.edit` (per-field merge). Keys `type`, `hpFormula`, `tokenShape` (not in `char.edit`) → `PUT /api/entities/:id`, built from the fresh snapshot row with only those keys changed. Both in one call → `char.edit` first, then `PUT`. | OQ-AGENT-03 |
| FR-AGENT-18 | `npc_put_row`: `CharPutRowIntent` → `char.putRow` (features, attacks, spells, items; no `id` = add). | FR-CHARX-16 |
| FR-AGENT-19 | NPC tools on a character → `invalid` "Not an NPC: use character_edit". On an imported definition, the server's `forbidden` ("Imported definitions are read-only. Derive a custom one.") is passed through. | FR-ENT-07 |

**Homebrew tools (slice 3)**

| ID | Requirement | Notes |
|---|---|---|
| FR-AGENT-20 | `homebrew_create`: `PutEntryBody` → `POST /api/compendium/entries` (not monsters: those are NPCs, FR-CMP-24). | |
| FR-AGENT-21 | `homebrew_edit {id, patch}`: `GET /api/compendium/entries/:id`, then the patch applied to its `EntryDraft`, then `PUT` with `shared`, `derivedFromId` and `imageAssetIds` kept from the GET. | OQ-AGENT-04 |
| FR-AGENT-22 | `homebrew_share {id, shared}`: the same GET → `PUT` with only `shared` changed. | |

**Character sheet tools (slice 4)**

| ID | Requirement | Notes |
|---|---|---|
| FR-AGENT-23 | `character_edit {id, set: CharEditSet}` → `char.edit`. DM authority: works on locked sheets and drafts, the same as the DM client (FR-CHARX-12). A monster id → `invalid` "Not a character: use npc_edit". | |
| FR-AGENT-24 | `character_put_row`: `CharPutRowIntent` → `char.putRow` on a character. | |

**Skill (slice 5)**

| ID | Requirement | Notes |
|---|---|---|
| FR-AGENT-25 | `.claude/skills/pocket-plane-content/SKILL.md` maps text, a URL's pasted text or an image (read by Claude; never uploaded or stored) to the §9 tools. Its description limits it to "the DM asks to create or edit Pocket Plane content". | §7.1 |
| FR-AGENT-26 | **Variants recipe**: one base (an SRD or custom NPC) → N `npc_derive` calls, each with a name, a `set` diff (AC, HP, speed, attacks) and `npc_put_row` features. | §7.1 |
| FR-AGENT-27 | **Dry-run check**: before any write the skill runs every planned call with `dryRun: true`, shows the DM one table (tool, name, key values, issues) and writes only after the DM says yes. The plan is executed in order; on the first failure it stops and reports what was written. | FR-AGENT-12 |
| FR-AGENT-28 | **Mount** = two NPCs (rider, mount) linked by a note. Each sheet's `notes` (via `char.edit`) gets one line: "Mount: ‹mount name›" / "Rider: ‹rider name›". When editing, the line is appended to the existing notes, not written over them. | #378 (5) |

## 7. UI/UX notes

- **Screens:** none. The DM's interface is Claude Code; no app UI changes ([visual-direction](../design/visual-direction.md) N/A).
- **States:** `server_not_running`, `server_busy`, `auth`, `conflict` (no active campaign), `server_stopped` and `timeout` are each one plain-language sentence plus the next step (§11).
- **DM view:** the DM client gets the same events, so new or edited NPCs show live in the Creatures window and the NPC sheet. Character sheets update live. Homebrew appears at the compendium window's next search / open (it never pushes, FR-CMP-23), the same as a form save.
- **Player view:** exactly as for the DM form. Their own character is full and live. Other characters show only the whitelist (FR-CHARX-35). NPC definitions, NPC sheets and unshared homebrew never reach them (ADR-0024, FR-CHARX-36, FR-CMP-14). A definition edit reaches players only through instance display copies (size, portrait, creature type on visible tokens; definition-changed hooks). Shared homebrew shows at their next compendium search.

### 7.1 Skill outline

| Part | Content |
|---|---|
| Input | Pasted text, a screenshot / photo of a stat block, or a short brief ("orc on a wolf") |
| Map | Monster stat block → `npc_create` / `npc_derive` + `npc_put_row` (traits / actions → Features, ≤ 600 chars each; weapon lines → attack rows). Spell / item / feature / condition / rule → `homebrew_create` (DM only unless the DM says "share") |
| Base first | `compendium_search` / `creatures_list` for an SRD or custom base; derive from it when one exists (keeps type, senses, scores) |
| Variants | Base + per-variant diff: "shield and mace" → AC +2, mace attack; "spear, runs fast" → speed +10, spear attack; "on a wolf" → rider + mount |
| Mount | Rider NPC + mount NPC (SRD Wolf derived, renamed "‹Rider›'s Wolf"); notes cross-lines (FR-AGENT-28) |
| Dry run | All calls `dryRun: true` → one table → DM OK → real calls in order |
| Never | Delete, guess ids, invent server fields, or write without the DM's OK |

## 8. Data model

N/A: no entity, table, field, record type or event. The MCP server holds no state except the in-memory "auth failed" flag (FR-AGENT-05). Records it writes are ordinary custom definitions, sheet rows and homebrew, with no agent marker (OQ-AGENT-09).

## 9. API & events

**Tools → existing routes / intents** (all DM authority; campaign = the active one).

| Tool | Input (zod source) | Route / intent → command | Visibility note |
|---|---|---|---|
| `campaign_get` | — | `GET /api/campaigns` | REST, DM only |
| `players_list` | — | WS snapshot `player`, `presence` | No link tokens (FR-AGENT-10) |
| `characters_list` | `{q?, cursor?}` | WS snapshot `entity` (character) | DM view |
| `character_get` | `{id}` | snapshot `entity` + `creature-sheet` | DM view |
| `creatures_list` | `{q?, cursor?}` | snapshot `entity` (monster: customs, pets) | DM view; SRD via `compendium_search` |
| `creature_get` | `{id}` | snapshot `entity` + `creature-sheet`; imported id → `sync.load {type: "imported-entity", ids: [id]}` | `imported-entity` is `audience: dm` |
| `compendium_search` | `SearchQuery` (`@shared/compendium/rest`) | `GET /api/compendium/search` | DM view incl. unshared homebrew |
| `compendium_get` | `{id}` | `GET /api/compendium/entries/:id` | as FR-CMP-12 |
| `npc_create` | `CreateEntityBody` monster (`@shared/entities/schemas`) | `POST /api/entities` → `entities.create` | `EntityCreated`; monsters hidden from players |
| `npc_derive` | `{baseId, name, set?: partial MonsterStatBlock}` or `DeriveMonsterBody` (`@shared/compendium/homebrew`) | `POST /api/entities` (`derivedFromId`) or `POST /api/compendium/derive-monster` → `cmp.deriveMonster` | DM only |
| `npc_edit` | `{id, set: CharEditSet}` (`@shared/character-sheet/sheet`) + `{type?, hpFormula?, tokenShape?}` | `char.edit`; extras `PUT /api/entities/:id` → `entities.update` | `CharacterSheetEdited` / `EntityUpdated`; players get only hook-changed instance copies |
| `npc_put_row` | `CharPutRowIntent` | `char.putRow` | NPC sheet hidden (FR-CHARX-36) |
| `homebrew_create` | `PutEntryBody` | `POST /api/compendium/entries` → `cmp.putEntry` | `CompendiumEntrySaved`, no changes; players see it only if `shared`, at next search |
| `homebrew_edit` | `{id, patch: partial EntryDraft}` | GET + `PUT /api/compendium/entries/:id` | as above |
| `homebrew_share` | `{id, shared}` | GET + `PUT /api/compendium/entries/:id` | unshare → gone at players' next search |
| `character_edit` | `{id, set: CharEditSet}` | `char.edit` | owner full; others whitelist (FR-CHARX-35) |
| `character_put_row` | `CharPutRowIntent` | `char.putRow` | owner + DM |

**No route / intent exists for** (raised, not invented):
- A per-field edit of a monster's `type`, `hpFormula` or `tokenShape`. Pick: a read-modify-write `PUT` (OQ-AGENT-03).
- Changing only `shared` or a few fields of a homebrew entry. Pick: a read-modify-write `PUT`, with no `If-Match` on the PUT (OQ-AGENT-04).
- A validate-only (dry-run) path. Pick: client-side zod + read checks (OQ-AGENT-07).
- A link between entities (ADR-0011 is open). Pick: sheet `notes` text (FR-AGENT-28).

**REST / WS intents added:** none. **WS events added:** none. The events tools cause, each with its existing visibility rule:

| Event (cause) | Changes | Visibility rule |
|---|---|---|
| `EntityCreated`, `EntityUpdated` | `entity` (+ hook-changed tokens, combatants) | ADR-0024: monster definitions DM only; instance copies by their own types' rules |
| `CharacterSheetEdited` | `entity` / `creature-sheet` + hook rows | FR-ENT-15 + FR-CHARX-35/36: DM, owner full; others whitelist; NPC sheets DM only |
| `CompendiumEntrySaved` | none (entries are off the WS, CON-44) | DM only; reads per FR-CMP-14 |

## 10. Permissions

| Action | DM (via MCP) | Player | Server check |
|---|---|---|---|
| Any tool | ✓ with `PP_DM_SECRET` | ✗ (no player credential is accepted) | DM secret (FR-CAMP-04); campaign at authentication (CON-21) |
| Edit imported definition | ✗ | ✗ | `forbidden` (FR-ENT-07) |
| Edit locked / draft character | ✓ (DM authority) | — | FR-CHARX-12 |
| Delete anything | ✗ (no tool) | — | tool allow-list (FR-AGENT-11) |

## 11. Edge cases & failure modes

**Error mapping** (FR-AGENT-08)

| Server answer | Tool `code` | Message (plus server message / issues) |
|---|---|---|
| no live lock / refused / reset before sending | `server_not_running` | "…Start the server: `bun run start`" |
| `loader` lock, `port` null | `server_busy` | "Fixture load running" / "Server starting" |
| 400 / `reject invalid` | `invalid` | zod `issues` `{path, message}` |
| 404 / `not_found` | `not_found` | server message |
| 403 / `forbidden` | `forbidden` | server message (e.g. imported read-only) |
| 409 / `conflict` (name taken, list full, no active campaign) | `conflict` | server message |
| 401 / close `4401` | `auth` | "…PP_DM_SECRET…" (FR-AGENT-05) |
| 429 | `throttled` | "wait a minute" |
| close / drop after sending, before answer | `server_stopped` | FR-AGENT-13 |
| no answer in 10 s | `timeout` | "Outcome unknown; read it back" |
| 500 / `internal` | `internal` | server message |

- **Player disconnect / reconnect:** unchanged. A player who is offline gets the change in their next snapshot.
- **DM disconnect / reconnect:** the DM client and the MCP server are separate connections; neither affects the other. A campaign switch during a call: REST writes stay in the campaign resolved at authentication (CON-21). A WS call gets close `4409` → `conflict`; the next call uses the new active campaign.
- **Server stops mid-call:** FR-AGENT-13. The command commits whole or not at all (ADR-0006), so a re-read after restart shows the truth. A two-step tool (`npc_edit` with extras, `homebrew_*` read-modify-write) reports which step completed.
- **Server crash, stale lock:** a dead PID is treated as not running. The MCP server leaves the file alone; the next `start` clears it (§9.2). PID reused by another process → the connection is refused → `server_not_running`.
- **Server restart:** nothing to recover. The next call reads the new lock / port.
- **Concurrent edits:** `char.edit` / `char.putRow` merge per field / row, as two DM tabs do. The read-modify-write `PUT`s are last write wins against an open DM form (OQ-AGENT-03/04).
- **Partial plans:** a skill plan stops at the first failure and lists what was written. With no delete tool, the DM removes leftovers in the DM client.
- **Invalid / malicious input:** all input goes through the server's own zod and checks. Pasted text is data for the skill, never instructions. Loopback only, so the secret never crosses the tunnel.

## 12. Performance & bandwidth

- Loopback only. One WS + DM snapshot per WS tool call: ≤ ~0.7 MB worst case (heavy DM snapshot, [protocol §58](../protocol/README.md#58-sprint-3-compendium-read-c2)), well under 1 s locally. A REST call is a single request.
- Tool output ≤ 50 summaries per list (~100 B each). A `get` is ≤ stat block 12 KB + sheet 48 KB.
- Player bandwidth: identical to the same edit from the form.
- `bun run bench`: none (no hot path).

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)), agent loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). Integration tests run a real in-process server (port 0, `:memory:` DB, temp data dir with a real `server.lock`) and drive the MCP server through the SDK's in-memory transport (stdio in one slow test). Test names: `FR-AGENT-NN …`.

**Bundle `agent-api`** (new, [fixtures-adapters](fixtures-adapters.md) names) = `base` + `player-2` + `char-mira` + `enemy-1` + `enemy-custom` ("Elite Goblin Warrior") + `cmp-srd-mini` + `cmp-homebrew` (incl. unshared `CMP-SECRET-ITEM`). No new unit: no new record type.

| Level | What | Fixtures |
|---|---|---|
| Unit | Lock reading (none, dead PID, `loader`, `port` null, unreadable); error mapping table; dry-run checks; read-modify-write merges; tool input schemas derive from `@shared`; boundary: `src/mcp` imports only the allowed modules, no DB module (FR-AGENT-04) | — |
| Integration | Each tool hits its §9 route / intent and nothing else (FR-AGENT-11); `players_list` has no `linkToken`; 401 then no further DM check (FR-AGENT-05); no active campaign → `conflict`; server stopped between `hello` and `ack` → `server_stopped`, re-read after restart; **live**: `player-1` socket gets Mira's `creature-sheet` upsert from `character_put_row`, `player-2` only the whitelist; **leak scan**: `player-*` frames never contain "Elite Goblin Warrior", derived NPC names or `CMP-SECRET-ITEM`; dry run sends no write (event log length unchanged) | `agent-api` |
| Integration (slow) | Real process + `PP_TEST_CRASH=entities.create:before-commit` / `:after-commit` → `server_stopped`; after restart, no row / the row; stdio round trip | `agent-api` |
| E2E (thin) | `e2e/agent-api.e2e.ts`: `mcp:call character_put_row` → `player-1` page shows the item, no reload | `agent-api` |

**Browser walkthrough A: an MCP edit reaches a player live** (bundle `agent-api`, verify profile, `pw-dm`, `pw-player-1`, `pw-player-2`)
1. DM client open; `player-1` opens Mira's sheet (Items); `player-2` joins.
2. `bun run mcp:call character_put_row '{creatureId: <Mira>, list: "items", row: {name: "Orc-tooth necklace", qty: 1, …}}' --profile verify` → `{rowId}`.
3. Expected: `player-1`'s sheet shows it within 2 s, no reload; the DM's sheet too; `player-2` sees no item text.
4. `mcp:call npc_derive '{baseId: <Elite Goblin Warrior>, name: "Orc Spear Runner", set: {speed: 40}}'` → the DM Creatures window shows it live; no player DOM contains the name.
5. `mcp:call homebrew_share '{id: <CMP-SECRET-ITEM>, shared: true}'` → `player-1`'s compendium search "CMP-SECRET" finds it (it didn't before).

**Browser walkthrough B: stopped server refuses**
1. Server running: `mcp:call campaign_get` OK; `bun run state:digest --profile verify` → D1.
2. Stop the server (Ctrl+C). `mcp:call creatures_list` and `mcp:call npc_create …` → exit non-zero, "start the server"; nothing written.
3. Start, then hard-kill the server (stale lock). Same calls → refused; the lock file is still there.
4. Restart: `state:digest` = D1; `mcp:call creatures_list` OK; DM client unchanged.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| `@modelcontextprotocol/sdk` | stdio server, in-memory test transport | needs DM OK (OQ-AGENT-01) |
| [live-sync](live-sync.md) | `hello`, `snapshot`, intents, `sync.load`, close codes | built |
| [campaign-management](campaign-management.md) | DM secret, `GET /api/campaigns`, server lock | built |
| [entities](entities.md), [character-sheet-full](character-sheet-full.md) | `POST` / `PUT /api/entities`, `char.edit`, `char.putRow` | built |
| [compendium](compendium.md) | search / get, homebrew `POST` / `PUT`, derive-monster | built |
| [fixtures-adapters](fixtures-adapters.md) | bundle `agent-api` (registry append) | to build |
| Shared files (orchestrator) | `package.json` scripts `mcp`, `mcp:call`; `tsconfig.json` alias `@mcp/*`; `biome.json` restricted imports; `src/boundaries.test.ts` area; AGENTS §9.1 row | ADR D5 |
| Integrator | Links to the old `specs/post-mvp/agent-api.md` (decisions-log #378, overview, feature-tiers, specs README, ADR-0009 / 0011 / 0016 "Affects") | at merge |

**Build slices** (in order; each with tests and its part of the walkthroughs)

| # | Slice | Paths |
|---|---|---|
| 1 | Core + read tools: config, lock, REST + WS client, errors, dry-run frame, `mcp:call`, bundle | `src/mcp/{index,server,lock,client,errors,dry-run}.ts`, `src/mcp/tools/read.ts`, `scripts/mcp-call.ts`, `fixtures/bundles/agent-api.ts` |
| 2 | NPC tools | `src/mcp/tools/npc.ts` |
| 3 | Homebrew tools | `src/mcp/tools/homebrew.ts` |
| 4 | Character sheet tools + walkthroughs A / B + e2e | `src/mcp/tools/character.ts`, `e2e/agent-api.e2e.ts` |
| 5 | Skill | `.claude/skills/pocket-plane-content/SKILL.md` (+ `examples/`) |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-AGENT-01 | New dependency `@modelcontextprotocol/sdk` (MIT)? | **Yes** (stdio + in-memory test transport, spec-conformant) / hand-rolled JSON-RPC over stdio | yes · owner: DM | ADR-0001, `package.json` |
| OQ-AGENT-02 | Drop the planned in-app paste-JSON importer / exporter ("Paste JSON" on the creature form, never built)? MCP + skill cover it | **Drop** (feature-tiers "AI paste" row → covered by agent-api) / keep | no · owner: DM | [feature-tiers](../feature-tiers.md), [compendium](compendium.md), #96 |
| OQ-AGENT-03 | Monster `type`, `hpFormula`, `tokenShape` aren't `char.edit` keys | **Read-modify-write `PUT` now**; ask [character-sheet-full](character-sheet-full.md) to add them to `char.edit` later / add them first | no · owner: spec-agent-api | character-sheet-full, entities |
| OQ-AGENT-04 | Homebrew edit / share without a per-field route or `If-Match` | **GET + whole `PUT`, last write wins** (as two DM tabs) / ask [compendium](compendium.md) for `If-Match` | no · owner: spec-agent-api | compendium |
| OQ-AGENT-05 | Connection lifetime | **One WS per call** (no state, no reconnect logic) / one kept-alive DM connection | no · owner: spec-agent-api | live-sync |
| OQ-AGENT-06 | After an `auth` failure | **Stop DM checks until restart** / retry each call (risks the DM throttle) | no · owner: spec-agent-api | campaign-management |
| OQ-AGENT-07 | Dry run with no server validate-only path | **Client-side `@shared` zod + read checks; documented gaps** (asset refs, races) / a `validateOnly` flag on routes (new server API, against #378 (2)) | no · owner: spec-agent-api | — |
| OQ-AGENT-08 | Portrait / token art upload tool (`POST /api/assets` exists) | **Not in the first cut** / add `asset_upload` | no · owner: DM | assets-pipeline |
| OQ-AGENT-09 | Mark agent-made records or log entries? | **No marker** (same as the form; DM authority) / a provenance field (schema change) | no · owner: DM | entities, compendium |
| OQ-AGENT-10 | Glossary: add **MCP server** ("The local stdio process that gives Claude Code tools over the running server; a DM caller") | **Add** / don't | no · owner: integrator | glossary |
| OQ-AGENT-11 | Architecture: transport, auth, finding the server, code location, registration | See [proposed ADR](../architecture/adr/proposed-agent-mcp-server.md) picks | yes · owner: DM | AGENTS §9.1, tooling |

## 16. Out of scope

- Delete tools, `char.deleteRow` / `char.moveRow`, campaign create / switch, players and links, combat, maps, scenes, dice, notes grooming. These are later rows of the stub's use cases ([feature-tiers](../feature-tiers.md) "Agent features").
- Cross-references between entities ([ADR-0011](../architecture/adr/0011-cross-references.md)).
- Live AI follow-along (tier F).
