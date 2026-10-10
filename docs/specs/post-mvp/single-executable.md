---
title: Single executable
prefix: PKG
status: stub
owner: —
phase: post-mvp
---

# Single executable (post-MVP stub)

- **What:** Package server + client bundles as one executable (e.g. `bun build --compile`) the DM double-clicks at game time.
- **Builds on:** [ADR-0001](../../architecture/adr/0001-tech-stack.md), [ADR-0003](../../architecture/adr/0003-local-hosting.md).
- **Open:**
  - Bundling `sharp` native binaries.
  - Bundling/launching cloudflared.
  - Migration on upgrade (`drizzle-kit generate` output at release).

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP.
