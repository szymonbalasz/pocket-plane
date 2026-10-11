---
title: Campaign management
prefix: CAMP
status: claimed
owner: spec-campaign-management
wave: 1
---

# Campaign management

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Create and switch campaigns; campaign is the top-level scope ([ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md)).
- Manage players and their invite links.
- DM secret auth; per-player links bound to a player name.

## 2. Scope

- Create and switch campaigns (DM). Rename/archive *(proposed)*.
- Add/remove players; generate per-player links.
- DM secret setup and DM login.
- Player join via link.
- Active campaign selection for the session.

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

> TODO (spec phase).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-CAMP-NN.

## 7. UI/UX notes

> TODO (spec phase): campaign switcher, player list, invite link copy, join screen. DM vs player view. Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): campaign, player, player link/token; DM secret storage.

## 9. API & events

> TODO (spec phase). Visibility rule per event.

## 10. Permissions

> TODO (spec phase).

## 11. Edge cases & failure modes

> TODO (spec phase): link reused on two laptops, removed player still connected, DM switches campaign mid-session, crash during campaign create.

## 12. Performance & bandwidth

> TODO (spec phase).

## 13. Test plan

> TODO (spec phase): fixture campaigns (e.g. empty, populated). Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | Connection auth binding | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CAMP-01 | Tunnel URL may change per session — how do player links survive? | **Link = path token; DM re-shares base URL** / fixed named tunnel / short redirect | yes | live-sync |
| OQ-CAMP-02 | ~~Player link revocation / rotation~~ **Decided: not needed (tier F)** — trusted table | — | — | — |
| OQ-CAMP-03 | How DM secret is set and stored | **Env var on first run, hashed in DB** / env only / generated on first run | yes | live-sync |
| OQ-CAMP-04 | Can multiple campaigns be live at once? | **No, one active campaign per server run** / yes | no | live-sync |
| OQ-CAMP-05 | Session journal in MVP? | See [ADR-0013](../architecture/adr/0013-session-journal-scope.md) | no | dice-roll-log, combat-tracker |
| OQ-CAMP-06 | ~~Campaign export/backup UI~~ **Decided: no UI (tier D)**; document copying the SQLite file + asset dir | — | — | — |

## 16. Out of scope

- User accounts, roles, ACL ([ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md)).
- Sessions, timeline, prep notes → [campaign-manager](post-mvp/campaign-manager.md).
