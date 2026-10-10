---
title: Agent / MCP API
prefix: AGENT
status: stub
owner: —
phase: post-mvp
---

# Agent / MCP API (post-MVP stub)

- **What:** API (likely MCP) letting an AI DM-assistant read and write campaign data: entities, notes, encounters.
- **Builds on:** [entities](../entities.md), [ADR-0009](../../architecture/adr/0009-entity-content-model.md), [ADR-0011](../../architecture/adr/0011-cross-references.md), [ADR-0004](../../architecture/adr/0004-tenancy-auth-permissions.md).
- **Open:**
  - Auth: DM-equivalent secret or scoped token?
  - Writes go through the same intent path (validation, events) as clients?
  - Available only while server runs ([ADR-0003](../../architecture/adr/0003-local-hosting.md)).

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP.
