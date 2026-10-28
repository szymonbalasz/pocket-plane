---
title: Agent / MCP API
prefix: AGENT
status: claimed
owner: spec-agent-api
phase: post-mvp
---

# Agent / MCP API (post-MVP stub)

- **What:** API (likely MCP) letting an AI DM-assistant read and write campaign data.
- **DM's use cases (much later):**
  - Story: idea bouncing on notes; grooming notes (backlinks, summaries) — what the DM's current custom agent does on the Obsidian vault.
  - Prep: quickly create NPCs; work on maps.
- **Design rule now:** every capability is a server command ([overview](../architecture/overview.md#cross-cutting-rules)); an agent is just another caller. Notes stay markdown + wikilinks so existing agent workflows carry over.
- **Builds on:** [entities](entities.md), [ADR-0009](../architecture/adr/0009-entity-content-model.md), [ADR-0011](../architecture/adr/0011-cross-references.md), [ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md).
- **Not planned:** live AI follow-along / summariser (tier F).
- **Open:**
  - Auth: DM-equivalent secret or scoped token?
  - Writes go through the same intent path (validation, events) as clients?
  - Available only while server runs ([ADR-0003](../architecture/adr/0003-local-hosting.md)).

> TODO (spec phase): expand from [_template.md](_template.md) after MVP.
