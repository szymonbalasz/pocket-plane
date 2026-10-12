# 0019 — DM secret and player link credentials

- Status: accepted (2026-10-12; picks accepted at the Phase 1 gate, D4, decisions-log #111)
- Date: 2026-10-11
- Affects: campaign-management, live-sync, fixtures-adapters
- Extends: [ADR-0003](0003-local-hosting.md); refines [ADR-0004](0004-tenancy-auth-permissions.md) (link bound to a player, not a name)

## Context

- ADR-0004 fixes the model (DM secret, one player link per player). It leaves open where the secret lives, the link format, and how links survive a tunnel URL change (ADR-0003).
- cloudflared forwards to localhost, so all tunnel traffic looks local. Source address can't be trusted.
- Raised in [campaign-management](../../specs/campaign-management.md#15-open-questions): OQ-CAMP-01, 03, 10.

## Options

| Topic | Option | Pros | Cons |
|---|---|---|---|
| DM secret | **A. Env config only, checked at start** | Simplest; per-worktree via env; never in the DB | Change = edit config + restart |
| | B. Env on first run, hashed in DB | Survives a config loss | Two sources of truth |
| | C. Generated on first run, printed | No setup | Awkward for fixtures; easy to lose |
| Player link | **A. Opaque random token (≥128 bit) in the URL path; host from a configured public base URL** | No infra; the DM re-copies links after a host change | New host → re-share links |
| | B. Fixed named tunnel | Stable links | Cloudflare account + domain |
| | C. Short-link redirect | Stable links | Cloud service (against ADR-0003) |
| Transport | **A. Credential sent per request / WS `hello`; DM client stores the secret; player token stays in the URL** | Stateless server | Secret kept in the DM's browser storage |
| | B. Login issues an httpOnly session cookie | Secret not kept client-side | Persisted session table |

## Decision

- **DM secret:** A — env config only, ≥ 12 characters, server refuses to start otherwise; never stored, logged or sent.
- **Player link:** A — 128-bit CSPRNG token, base64url, in the URL path; links built from a configured public base URL; DM re-copies after a host change.
- **Transport:** A — DM client keeps the secret in localStorage and sends it per REST request and in the WS `hello`; player token stays in the URL.
- **No auth by source address**, localhost included.

## Consequences

- live-sync binds connections via `verifyDmCredential` and `resolvePlayerLink` (campaign-management §9).
- Build conventions define env names for the DM secret and the public base URL.
- Fixtures take the DM secret from worktree env. Seeded tokens only when the data dir is flagged disposable ([ADR-0022](0022-deterministic-seams.md)); real tokens always come from a CSPRNG.
- No revocation or rotation (tier F): a link stays valid for the player's life; rename keeps the token.
