# 0006 — Persistence model

- Status: accepted
- Date: 2026-10-10
- Affects: all specs; data-model consolidation

## Context

- Need queryable, migratable state that survives a crash mid-session.

## Decision

- **Relational SQLite schema.**
- **JSON columns only for document-shaped leaf data**, e.g. polygon points, condition lists, stat-block actions. Validated by zod on read/write.
- **No single-JSON-blob state** (no "whole campaign/scene as one document").
- **Runtime/session state lives in the app DB**: tokens, fog, initiative, HP, roll log. Must survive a server crash.

## Consequences

- Every mutation is committed before its event is broadcast.
- No in-memory-only state that matters to play; caches must be rebuildable from DB.
- Specs list fields and say which (if any) are JSON leaves.
- Entity content model ([ADR-0009](0009-entity-content-model.md)) must fit within these rules.
