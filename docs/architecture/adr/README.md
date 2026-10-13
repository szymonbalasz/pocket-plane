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
| [0018](0018-global-imported-content.md) | Imported reference content is global; custom content per campaign | accepted |
| [0019](0019-auth-credentials.md) | DM secret and player link credentials | accepted |
| [0020](0020-single-active-campaign.md) | Several campaigns, one active per server | accepted |
| [0021](0021-sync-protocol-conventions.md) | Sync protocol conventions | accepted |
| [0022](0022-deterministic-seams.md) | Deterministic IDs, tokens and clock for fixtures and tests | accepted |
| [0023](0023-asset-access-by-capability-id.md) | Asset access by capability ID | accepted |
| [0024](0024-definition-visibility.md) | Creature definitions DM-only for players; instances carry read-only display copies | accepted (refines 0009) |
| [0025](0025-play-shell-windows.md) | Feature UI as play-shell windows; layout in browser storage | accepted |
| [0026](0026-signal-routing.md) | Signal routing: sender stamp, DM-only pull, receiver scene filter | accepted |
| [0027](0027-notification-creation.md) | Notifications are created in the causing command's transaction | accepted (refines 0016) |
| [0028](0028-token-changed-hooks.md) | Token-changed hooks keep bound instances in step | accepted (extends 0024) |
| [0029](0029-windowed-record-types.md) | Windowed record types: bounded snapshots for append-only logs | accepted (amends FR-SYNC-20) |
| [0030](0030-ui-notification-sounds.md) | Short UI notification sounds (turn alert) | accepted (amends ADR-0007) |

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
