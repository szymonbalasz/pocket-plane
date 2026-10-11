# Data model

Consolidated domain model. Entities and relationships, **not SQL**. **Living doc**: the integrator extends it after each build phase's specs reach `complete` ([process](../process.md#stages), [roadmap](../roadmap.md#build-order-mvp)).

> TODO (spec phase): populate from Foundation specs first, then extend per phase. Don't edit from a feature worktree.

## Inputs

- Section 8 (Data model) of every [MVP spec](../specs/README.md).
- [ADR-0006](../architecture/adr/0006-persistence.md) persistence rules.
- [ADR-0009](../architecture/adr/0009-entity-content-model.md), [0010](../architecture/adr/0010-compendium-design.md), [0011](../architecture/adr/0011-cross-references.md), [0012](../architecture/adr/0012-character-derived-values.md) once decided.

## Will contain

- Entity–relationship diagram (Mermaid `erDiagram`).
- Per entity: fields, types, JSON leaf fields, owning spec.
- Relations and cardinality.
- Derived values and where they're computed.
- Which records are runtime/session state (crash-durable).
- Visibility-relevant fields (what the filter reads).

## Conflicts log

| Entity / field | Specs in conflict | Resolution |
|---|---|---|
