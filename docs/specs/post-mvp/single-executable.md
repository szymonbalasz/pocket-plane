---
title: Single executable
prefix: PKG
status: stub
owner: —
phase: post-mvp
---

# Single executable (post-MVP stub)

> **2026-10-31 (DM, [#413](../../decisions-log.md)): deferred. Nice, not needed now; revisit if other people start using it, since running it is developer-centric today.**

- **What:** Package server + client bundles as one executable (e.g. `bun build --compile`) the DM double-clicks at game time.
- **Builds on:** [ADR-0001](../../architecture/adr/0001-tech-stack.md), [ADR-0003](../../architecture/adr/0003-local-hosting.md).
- **Open:**
  - Bundling `sharp` native binaries.
  - Bundling/launching cloudflared.
  - Migration on upgrade (`drizzle-kit generate` output at release; "release" = someone else runs the app, [#416](../../decisions-log.md)). `drizzle-kit` is a dev dependency that `src/server/db/push.ts` runs in production today, so a packaged build needs these migrations first.

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP.
