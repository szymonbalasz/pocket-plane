# 0003 — Local hosting via cloudflared

- Status: accepted
- Date: 2026-10-10
- Affects: live-sync, assets-pipeline, campaign-management

## Context

- One table, sessions a few hours a week. Cloud hosting is cost and ops with no benefit.

## Decision

- Server runs on the **DM's machine**, started at game time. No always-on service.
- Players connect via a **cloudflared tunnel**.
- No cloud services, storage or databases.

## Consequences

- Server may be offline between sessions; players can't access anything then.
- Bandwidth is the DM's upload: assets must be cached and preloaded ([assets spec](../../specs/assets-pipeline.md)).
- Tunnel URL may change between sessions → player links must survive a host change.
  > TODO (spec phase): resolve in [campaign-management](../../specs/campaign-management.md).
- Server crash / laptop sleep is a realistic failure; state must persist ([ADR-0006](0006-persistence.md)).
