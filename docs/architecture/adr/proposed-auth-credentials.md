# NNNN — DM secret and player link credentials

- Status: proposed
- Date: 2026-10-11
- Affects: campaign-management, live-sync, fixtures-adapters
- Extends: [ADR-0003](0003-local-hosting.md), [ADR-0004](0004-tenancy-auth-permissions.md)

## Context

- ADR-0004 fixes the model (DM secret, one player link per player). It leaves open where the secret lives, the link format, and how links survive a tunnel URL change (ADR-0003).
- cloudflared forwards to localhost, so all tunnel traffic looks local. Source address can't be trusted.
- Raised in [campaign-management](../../specs/campaign-management.md#15-open-questions): OQ-CAMP-01, 03, 07, 10.

## Options

| Topic | Option | Pros | Cons |
|---|---|---|---|
| DM secret | **A. Env config only, checked at start** | Simplest; per-worktree via env; never in the DB | Change = edit config + restart |
| | B. Env on first run, hashed in DB | Survives a config loss | Two sources of truth |
| | C. Generated on first run, printed | No setup | Awkward for fixtures; easy to lose |
| Player link | **A. Opaque random token (≥128 bit) in the URL path; host from a configured public base URL** | No infra; the DM re-copies links after a host change | New host → re-share links |
| | B. Fixed named tunnel | Stable links | Cloudflare account + domain |
| | C. Short-link redirect | Stable links | Cloud service (against ADR-0003) |
| Transport | **A. Credential sent per request / WS auth; DM client stores the secret; player token stays in the URL** | Stateless server | Secret kept in the DM's browser storage |
| | B. Login issues an httpOnly session cookie | Secret not kept client-side | Persisted session table |

## Decision

> Undecided. Suggested: **A / A / A**. In every case: **no auth by source address**.

## Consequences

- live-sync binds connections via `verifyDmCredential` and `resolvePlayerLink` (campaign-management §9).
- Build conventions define env names for the DM secret and the public base URL.
- Fixtures set the DM secret via worktree env. Stable tokens come from the seeded-random seam.
