---
title: Campaign management
prefix: CAMP
status: in-review
owner: spec-campaign-management
wave: 1
---

# Campaign management

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Several campaigns, one **active campaign** per server; the DM creates and switches ([ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md), [proposed ADR](../architecture/adr/proposed-single-active-campaign.md)).
- DM secret for the DM; one player link per player, opened with no other setup ([proposed ADR](../architecture/adr/proposed-auth-credentials.md)). Built first, in the Phase 2 skeleton ([roadmap](../roadmap.md#build-order-mvp)).

## 2. Scope

- DM secret from env config; DM login. Campaigns: create, list, rename, switch. Players: add, rename, copy link.
- Player page (joined, invalid-link, waiting). Links that survive server restarts and tunnel URL changes ([ADR-0003](../architecture/adr/0003-local-hosting.md)).

## 3. Goals

- A player joins by opening the player link, nothing else ([vision](../vision.md#success-criteria)).
- DM and player survive a reload and a server restart without re-entering anything.
- No player connection ever receives the DM secret, any link token or another campaign's data.
- A new tunnel URL needs no data change: the DM re-copies links (same tokens).

## 4. Non-goals

- User accounts, roles, ACL ([ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md)).
- Removing players; link revocation, rotation, kick (tier F, [feature tiers](../feature-tiers.md#5-dm-tools); D2).
- Several campaigns live at once; campaign delete / archive.
- Backup UI (tier D: copy the SQLite file + asset dir). Session tracking ([ADR-0013](../architecture/adr/0013-session-journal-scope.md)). Managing the tunnel.

## 5. User stories

N/A — the goals in §3 are the stories; listing them again adds nothing.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-CAMP-01 | Server reads the DM secret from env config at start. Unset, empty or < 12 characters → refuses to start with a clear error. | |
| FR-CAMP-02 | DM client shows a login screen until a valid DM secret is entered. A wrong secret shows an error and grants nothing. | |
| FR-CAMP-03 | Compare = `crypto.timingSafeEqual` on SHA-256 digests of the presented and configured secret. The secret is never logged, stored in the DB, or put in any response, event or event log entry. | |
| FR-CAMP-04 | DM client keeps the secret in localStorage and sends it on every DM REST request and in `hello`; DM stays logged in across reload and restart. Changed secret → 401 / invalid-credential close → login screen. Access is never granted by source address (localhost included). | Tunnel traffic is local |
| FR-CAMP-05 | After 5 failed DM credential checks (any route, incl. `hello`) within 60 s, server-wide, every DM credential check is refused for 60 s, even a correct one (REST 429; `hello` closed as invalid credential). The counter is in memory and resets on server restart. | [OQ-CAMP-12](#15-open-questions) |
| FR-CAMP-06 | DM creates a campaign: name trimmed, 1–60 characters, unique (case-insensitive); duplicate → error, nothing created. Created while none is active → becomes active; otherwise inactive. | |
| FR-CAMP-07 | DM lists all campaigns, active one marked, via REST only. No WS message carries another campaign's data. | |
| FR-CAMP-08 | At most one campaign is active (DB-enforced). The active campaign survives a server restart. | |
| FR-CAMP-09 | DM switches the active campaign: one transaction flips both flags. ≤ 1 s after commit the server closes every connection (DM and player) of the previous campaign with close reason `campaign-inactive`; none is re-snapshotted into another campaign. The DM client reconnects and is live in the new campaign ≤ 2 s after the close. | Code: live-sync |
| FR-CAMP-10 | *(proposed)* DM renames a campaign (FR-CAMP-06 rules). Open connections of that campaign show the new name ≤ 1 s after commit, no reload. | [OQ-CAMP-09](#15-open-questions) |
| FR-CAMP-11 | A player connection's campaign comes from its link only; a DM connection's is the active campaign at `hello`. Fixed for the connection's life; request input never sets it. | [FR-SYNC-03](live-sync.md#6-functional-requirements) |
| FR-CAMP-12 | DM adds a player to the active campaign: name trimmed, 1–40 characters, unique (case-insensitive) in the campaign. | |
| FR-CAMP-13 | Adding a player creates a link token: 128 bits from `crypto.randomBytes`, base64url, unique server-wide. Seeded tokens only via the deterministic seam when the data dir is flagged disposable. The link stays valid across restarts and base URL changes; MVP has no way to invalidate it. | [OQ-CAMP-11](#15-open-questions), D2 |
| FR-CAMP-14 | DM player list shows name, online state ([live-sync](live-sync.md) presence) and copy link. Copy puts `<public base URL>/p/<token>` on the clipboard; after a base URL change, re-copying gives a working link with the same token. | Path illustrative; [OQ-CAMP-07](#15-open-questions) |
| FR-CAMP-15 | DM renames a player; the token is unchanged. Open connections of that campaign show the new name ≤ 1 s after commit. | |
| FR-CAMP-16 | Valid link, active campaign → joined with no input; page shows player and campaign name. Reload keeps the player joined. The same link may be open in several browsers; all connect as that player. | Later: active scene ([play-shell](play-shell.md)) |
| FR-CAMP-17 | Unknown token → invalid-link screen (§7). REST 404; WS closed as invalid credential before any data frame. | |
| FR-CAMP-18 | Valid token, inactive campaign (on open or after a switch) → waiting screen naming the campaign. The page joins ≤ 10 s after the DM activates that campaign, no reload. | live-sync retry, cap 5 s ± 20 % |
| FR-CAMP-19 | Player connections never receive the DM secret, any link token, or another campaign's data. They receive `{id, name}` of every player in their own campaign. | [OQ-CAMP-13](#15-open-questions) |
| FR-CAMP-20 | Every mutation is a server command committing in one transaction with its event log entry ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). Fixtures call the same commands. | |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark only, laptop viewports; test ID on every interactive element ([ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)).

- **DM view** (skeleton: plain DM page; later placement is [play-shell](play-shell.md)'s):
  - Login: password input + submit; inline error; throttled → "Too many attempts. Try again in a minute."
  - Campaign switcher: Select, active marked; "New campaign" Dialog. Players online → confirm Dialog "Switch to **X**? N online players will wait until you switch back." Loading while the DM connection reconnects.
  - Players panel: Table — name, online dot, copy link (Toast "Link copied"), rename; add-player input below. Shows the base URL used; warns if it is localhost.
  - Empty: "Create your first campaign" / "Add a player to get a link". Validation inline; server errors as Toast; disconnected banner from [live-sync](live-sync.md).
- **Player view** (`/p/<token>`, loading first). This spec owns the wording; live-sync's player `rejected` state shows the invalid-link screen.
  - Joined (skeleton): "Playing as **Player 1** in **Fixture Campaign**". Later: the active scene.
  - Invalid link: "This link isn't recognised. Check that you opened the whole link your DM sent."
  - Waiting: "**Fixture Campaign** isn't running right now. This page joins automatically when the DM starts it."

## 8. Data model

No JSON leaf fields ([ADR-0006](../architecture/adr/0006-persistence.md)). DM secret: env only, not persisted.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Campaign | id | ID | The scope itself; no `campaignId` |
| | name | text | 1–60, unique case-insensitive |
| | active | boolean | At most one `true` (partial unique index) |
| | createdAt, updatedAt | timestamp | Clock seam ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)) |
| Player | id | ID | Referenced by owned records (characters, tokens) |
| | campaignId | ID → Campaign | |
| | name | text | 1–40, unique case-insensitive per campaign |
| | linkToken | text | Unique; plain text so the DM can re-copy. Never in a sync record, event or log entry |
| | createdAt, updatedAt | timestamp | |

- **Relations:** Campaign 1—* Player 1—* owned records ([entities](entities.md), [scenes-map](scenes-map.md)); no removal → no dangling owners. **Derived:** link URL = public base URL + path + `linkToken`; online state from presence. **Persisted runtime state:** `Campaign.active` (throttle counter: memory only).

## 9. API & events

Envelopes, errors and close codes: [live-sync](live-sync.md). CRUD over REST (OQ-SYNC-04). Paths illustrative. **WS intents:** none.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/dm/login` | anyone | Verify DM secret → 204 / 401 / 429 |
| GET, POST | `/api/campaigns` | DM | List all + active flag; create |
| PATCH | `/api/campaigns/:id` | DM | Rename *(proposed)* |
| POST | `/api/campaigns/:id/activate` | DM | Switch active campaign |
| GET, POST | `/api/players` | DM | Active campaign's players incl. `linkToken` (only route returning tokens); add |
| PATCH | `/api/players/:id` | DM | Rename |
| GET | `/api/join/:token` | token holder | `{playerName, campaignName, campaignActive}` or 404 |

- **Record types** (generic record changes `{type, id, op, data}` + cause, OQ-SYNC-07): `campaign {id, name}` and `player {id, campaignId, name}` (no token field exists). Scope `campaign`; visibility = full for connections of their own campaign; snapshot = own campaign row / all its players.
- **Close reason `campaign-inactive`** (retryable; also sent at `hello` for a valid token of an inactive campaign): player client → waiting screen, keeps retrying; DM client → reconnects at once.
- **Provided to live-sync:** `verifyDmCredential(value) → {campaignId} | invalid | throttled | noActiveCampaign`; `resolvePlayerLink(token) → {campaignId, playerId, campaignActive} | null`. With no active campaign the DM client stays on REST and opens no WS.

| Domain event | Changes | Logged | Transient | Undoable | After commit |
|---|---|---|---|---|---|
| CampaignCreated | `campaign` upsert | yes | no | no | — (new campaign has no connections) |
| CampaignRenamed | `campaign` upsert | yes | no | no | — |
| CampaignActivated `{campaignId, previousCampaignId}` | none | yes | no | no | `disconnect(previous campaign, campaign-inactive)` |
| PlayerAdded / PlayerRenamed | `player` upsert | yes | no | no | — |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Log in as DM | ✓ | ✗ | FR-CAMP-03 compare; FR-CAMP-05 throttle |
| Create / rename / switch campaign; add / rename player; read link tokens | ✓ | ✗ | DM credential |
| Join a campaign | — | Own link only | Token resolves; campaign active |
| Read own campaign name + player names | ✓ | ✓ | Campaign from the connection context |

No player-writable actions in this spec.

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** reconnects with the URL token; fresh snapshot. Campaign switched meanwhile → waiting screen.
- **DM disconnect / reconnect:** players unaffected; DM client re-sends the stored secret in `hello` → active campaign's snapshot.
- **Server crash:** each command is one transaction (row + log): all or nothing. Retried create → unique-name error. Activation flips both flags at once: never zero or two active. Crash after the activation commit: connections drop anyway; old-campaign players then get `campaign-inactive`. After restart: DM still logged in, same active campaign, links work, throttle cleared. Server or tunnel down: page can't load; new tunnel host → DM re-copies links.
- **Concurrent edits:** two DM tabs → last write wins; racing creates/renames → DB uniqueness gives one success, one error. A switch closes the other DM tabs too; in-flight intents are not resent ([FR-SYNC-17](live-sync.md#6-functional-requirements)).
- **Invalid / malicious input:** zod on every route; names trimmed, control characters rejected, rendered as text. Unknown token → 404, no detail; 128-bit tokens need no join rate limit. A player on the DM route sees only the login screen. Anyone reaching the tunnel can keep the DM locked out in 60 s windows (accepted, trusted table; OQ-CAMP-12).

## 12. Performance & bandwidth

- A handful of campaigns, ≤ ~7 players each; payloads < 2 KB; no assets. Join = one small REST call + the snapshot ([ADR-0003](../architecture/adr/0003-local-hosting.md)). Switch: close ≤ 1 s after commit; DM live ≤ 2 s later; waiting players join ≤ 10 s after reactivation.

## 13. Test plan

Isolated per worktree: fresh temp DB and asset dir, own ports, DM secret from worktree env, data dir flagged disposable ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)).

- **Fixtures** from [fixtures-adapters](fixtures-adapters.md): `base` (campaign "Fixture Campaign", active; `player-1` "Player 1"), `player-2` ("Player 2"). **Added here**, on `base`: `campaign-second` = campaign "Second Campaign", inactive, player "Second Player" (stable link via the seeded seam).
- **Bundle `campaign-switch`** = `base` + `player-2` + `campaign-second`.

| Level | What | Fixtures |
|---|---|---|
| Unit | Name rules; token length/charset; secret compare; throttle window (fake clock); link building; startup refusal | none |
| Integration | Each command commits row + log entry (injected failure → neither). At most one active. DM routes 401 without secret / with a player token. 5 failures → 429 even for the correct secret; restart clears. Unknown token → 404 + invalid-credential close, no data frame. Inactive campaign → `campaign-inactive` at `hello`. Switch closes all old-campaign connections ≤ 1 s; DM reconnect snapshot = new campaign. No `linkToken` in any WS frame, snapshot or log row. | `base`, `campaign-switch` |
| E2E (thin) | Playwright: the walkthrough below, scripted | `campaign-switch` |

**Browser walkthrough** (DM and each player in separate browser contexts; reset + load `campaign-switch`, app on the worktree ports):

1. **DM:** wrong secret → error; fixture secret → "Fixture Campaign" active, players Player 1 and Player 2.
2. **Player A:** open `player-1` link → "Playing as Player 1 in Fixture Campaign"; DM sees Player 1 online.
3. **DM:** add "Thorn", copy the link from the UI; **Player B** opens it → joined. **DM:** rename Thorn → "Thorin" → B and A update ≤ 1 s, no reload.
4. **All:** reload → still joined / logged in. **Player D:** mangled link → invalid-link screen, §7 wording.
5. **DM:** switch to "Second Campaign", confirm → DM shows Second Campaign; A and B wait (screen names Fixture Campaign). **Player C:** Second Player's link → joined.
6. **DM:** switch back → A and B join ≤ 10 s, no reload; C waits.
7. Kill and restart the server → DM still logged in, Fixture Campaign active, A and B reconnect.
8. **Throughout:** no player's WS frames or REST responses contain another player's token or the DM secret.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | `hello` binding via our resolvers; retryable close code for `campaign-inactive` (player: wait + retry; DM: reconnect); drop the `player-removed` close and fixture-load resync; player `rejected` state uses §7 wording; presence; record types `campaign`, `player` | open |
| [fixtures-adapters](fixtures-adapters.md) | `base`, `player-2`; loader calls our commands; seeded tokens only when disposable; DM secret from env (OQ-FIX-13) | open |
| [play-shell](play-shell.md), [entities](entities.md), [scenes-map](scenes-map.md) | Placement of switcher, players panel and player landing; owned records reference `Player.id` | phase 2 |
| Build conventions (AGENTS.md) | Env names (DM secret, public base URL); disposable-data flag; seam mechanism | open |

## 15. Open questions

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CAMP-01 | ~~Links across tunnel URL changes~~ **Decided (D4):** opaque token in path; public base URL from config; DM re-copies. | — | — | — |
| OQ-CAMP-02 | ~~Link revocation / rotation~~ **Decided:** no (tier F). | — | — | — |
| OQ-CAMP-03 | ~~DM secret storage~~ **Decided (D4, #112):** env only, ≥ 12 chars, never stored. | — | — | — |
| OQ-CAMP-04 | ~~Several live campaigns?~~ **Decided (D1, #108):** several campaigns, one active, DM switches ([proposed ADR](../architecture/adr/proposed-single-active-campaign.md)). | — | — | — |
| OQ-CAMP-05 | ~~Session journal~~ **Decided:** no ([ADR-0013](../architecture/adr/0013-session-journal-scope.md)). | — | — | — |
| OQ-CAMP-06 | ~~Backup UI~~ **Decided:** no (tier D). | — | — | — |
| OQ-CAMP-07 | How does the server know the public base URL? | **Env config; unset → DM client's origin + warning** (restart on host change) / DM pastes it in the UI (one more setting) / parse cloudflared output (couples to the tool) | no · owner: spec-campaign-management | — |
| OQ-CAMP-08 | ~~Remove player~~ **Decided (D2, #109):** no remove in MVP. | — | — | — |
| OQ-CAMP-09 | Player rename **decided (D2)**. Campaign rename in MVP too? | **Yes** (near-free, fixes typos) / defer | no · owner: spec-campaign-management | — |
| OQ-CAMP-10 | ~~Credential transport~~ **Decided (D4):** secret in localStorage, per request + `hello`; token in URL. | — | — | — |
| OQ-CAMP-11 | ~~Stable fixture links~~ **Decided via OQ-FIX-12** ([proposed ADR](../architecture/adr/proposed-deterministic-seams.md)): seeded only when the data dir is disposable; real tokens from a CSPRNG. | — | — | — |
| OQ-CAMP-12 | Login throttle policy (FR-CAMP-05) | **Global 5 / 60 s → 60 s lockout** (simple; lockout abusable) / per IP via tunnel header (trusts a header) / none (secret open to the internet) | no · owner: spec-campaign-management | live-sync |
| OQ-CAMP-13 | Players see other players' names? | **Yes, `{id, name}`** (game log, party UI) / no (others resolve names) | no · owner: spec-campaign-management | dice-roll-log, play-shell |
| OQ-CAMP-14 | Glossary: add **Active campaign** (the one campaign the server serves to players), **Public base URL** (external URL, usually the tunnel, used to build player links), **Link token** (opaque secret in a player link's path; the player's credential). Reword **Player link** "bound to one player name" → "bound to one player": rename keeps the token, while ADR-0004 says "bound to a player name". | **Add all; reword** / keep spec-local | no · owner: integrator | glossary, ADR-0004 |

## 16. Out of scope

N/A — covered by §4.
