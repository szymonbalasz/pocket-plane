# Pocket Plane

A self-hosted virtual tabletop and campaign manager for one DM and ~6 remote players. D&D 5e (2014 SRD). Built for a single table, not as a product.

Replaces Owlbear Rodeo (map), Shieldmaiden (combat) and, later, Miro (party board). Gradually absorbs the DM's campaign notes.

**Current phase: spec writing.** No application code yet. Specs first, build later.

## Start here

| If you want to… | Read |
|---|---|
| Write or review a spec | [AGENTS.md](AGENTS.md), then [docs/process.md](docs/process.md) |
| Know what we're building and why | [docs/vision.md](docs/vision.md) |
| Know the agreed terms | [docs/glossary.md](docs/glossary.md) |
| Know what's already decided | [docs/decisions-log.md](docs/decisions-log.md), [ADRs](docs/architecture/adr/README.md) |
| See the system shape | [docs/architecture/overview.md](docs/architecture/overview.md) |
| See what to spec, in what order | [docs/roadmap.md](docs/roadmap.md), [spec index](docs/specs/README.md) |
| Know if a feature is in | [docs/feature-tiers.md](docs/feature-tiers.md) |
| Style a screen | [docs/design/visual-direction.md](docs/design/visual-direction.md) |

## Layout

```
AGENTS.md                 rules for spec-phase agents
docs/
  vision.md  glossary.md  roadmap.md  process.md  decisions-log.md
  design/                 visual direction
  architecture/           overview + ADRs
  specs/                  MVP feature specs (+ post-mvp/ stubs)
  data-model/             consolidated domain model (after specs)
  protocol/               consolidated REST + WS catalogue (after specs)
```
