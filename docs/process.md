# Process

Specs before code, **just in time per build phase**: each phase's specs are written, reviewed and consolidated right before that phase is built ([roadmap](roadmap.md#build-order-mvp)).

## Stages

```mermaid
graph LR
  A[Spec phase N] --> B[Review] --> C[Extend data model + protocol] --> E[Build phase N]
  E -. meanwhile .-> A2[Spec phase N+1]
  B -- changes requested --> A
  C -- conflict found --> A
  D -- conflict found --> A
```

| Stage | Who | Input | Output | Done when |
|---|---|---|---|---|
| Spec | One Herdr agent per feature, own worktree | Template, ADRs, glossary | `docs/specs/<feature>.md` at `in-review` | Meets [spec complete](../AGENTS.md#8-definition-of-spec-complete) checklist |
| Review | The DM (human) | Spec at `in-review` | Comments or `status: complete` | Checklist ticked |
| Data model consolidation | Integrator | This phase's `complete` specs, §8 | [data-model/](data-model/README.md) (living) | No conflicts with earlier phases or built code |
| Protocol consolidation | Integrator | This phase's `complete` specs, §9 | [protocol/](protocol/README.md) (living) | Catalogue extended; visibility rules for every event |
| Build | Builder + test agents per feature, orchestrated in Herdr | Consolidated docs | Code | Build conventions in AGENTS.md (drafted at Phase 3 of the [orchestrator prompt](agents/orchestrator-prompt.md)) |

## Roles

- **Spec agent** — writes one spec in one worktree. Edits only that spec + new proposed ADRs.
- **Reviewer** — the DM (human, not an agent). Checks a spec against the checklist, ADRs, glossary. Sets `complete`. Also accepts/rejects proposed ADRs.
- **Integrator** — the **orchestrator agent** running in Herdr ([prompt](agents/orchestrator-prompt.md)). Spawns spec/build/test agents in worktrees, merges worktrees, numbers proposed ADRs, updates the [spec index](specs/README.md), [glossary](glossary.md) and [decisions log](decisions-log.md).

## Avoiding conflicting decisions

- **ADRs are law.** Accepted ADRs can't be contradicted, only superseded by a new ADR.
- **Cross-cutting → ADR.** Anything that affects more than one spec goes in `adr/proposed-<slug>.md`, not in a spec.
- **Don't edit others' specs.** Raise an open question in yours naming theirs. Integrator routes it.
- **Glossary is shared vocabulary.** New terms go through open questions; integrator adds them.
- **Decisions log is append-only**, written by the integrator at merge. One line per decision, with link.
- **Front matter is the claim board.** No shared status file to conflict on.

## Merging

1. Spec agent rebases on `main`, resolves only its own files.
2. Integrator merges, then in a follow-up commit: numbers ADRs, updates index, glossary, decisions log.
3. If two proposed ADRs conflict, integrator raises it with the DM before accepting either.
