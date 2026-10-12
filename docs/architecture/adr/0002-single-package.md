# 0002 — Single package, path aliases

- Status: accepted
- Date: 2026-10-10
- Affects: build phase; all specs indirectly

## Context

- One-table app; monorepo tooling (workspaces, per-package builds) adds overhead without benefit.

## Decision

- One package. No workspaces.
- Code separated by directory and **path aliases** (e.g. server, DM client, player client, shared schemas).

- Layout and aliases: [AGENTS.md §9.1](../../../AGENTS.md#91-directory-layout-and-path-aliases).

## Consequences

- Shared zod schemas imported directly by server and both clients.
- DM-only code must not be bundled into the player client (enforced by entry points/aliases, defined at build phase).
