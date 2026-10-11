# Architecture Decision Records

One ADR per decision area. Accepted ADRs are binding; change them only via a superseding ADR.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-tech-stack.md) | Tech stack | accepted |
| [0002](0002-single-package.md) | Single package, path aliases | accepted |
| [0003](0003-local-hosting.md) | Local hosting via cloudflared | accepted |
| [0004](0004-tenancy-auth-permissions.md) | Tenancy, auth and permissions | accepted |
| [0005](0005-server-authoritative-sync.md) | Server-authoritative sync | accepted |
| [0006](0006-persistence.md) | Persistence model | accepted |
| [0007](0007-product-scope.md) | Product scope and exclusions | accepted, partly superseded by 0014 |
| [0008](0008-parallel-dev-isolation.md) | Parallel dev isolation | accepted |
| [0009](0009-entity-content-model.md) | Entity content model | accepted |
| [0010](0010-compendium-design.md) | Compendium design | proposed (re-import safety decided) |
| [0011](0011-cross-references.md) | Cross-reference model | proposed |
| [0012](0012-character-derived-values.md) | Character sheet: derived vs stored, homebrew overrides | accepted for MVP basics (stored); full sheet open |
| [0013](0013-session-journal-scope.md) | Session outcomes / journal: MVP or post-MVP | accepted — no session tracking |
| [0014](0014-mvp-scope.md) | MVP is a playable session simulation | accepted |
| [0015](0015-source-adapters-fixtures.md) | Import pipeline and source adapters | accepted |
| [0016](0016-domain-events-pending-actions.md) | Domain events and pending actions | accepted (core) |
| [0017](0017-agent-verification-fixture-library.md) | Agent-driven verification and fixture library | accepted |

## Proposing a new ADR

- Create `proposed-<slug>.md` from the template below. Integrator assigns a number at merge.
- Status flow: `proposed → accepted | rejected`, later `superseded by NNNN`.

## Template

```markdown
# NNNN — Title

- Status: proposed
- Date: YYYY-MM-DD
- Affects: <specs>

## Context
- Why this needs deciding.

## Options
| Option | Pros | Cons |
|---|---|---|

## Decision
> Undecided. / The chosen option, in one line.

## Consequences
- What changes for specs/build.
```
