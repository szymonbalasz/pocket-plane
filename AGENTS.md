# AGENTS.md — Spec-phase conventions

Applies to every agent (and human) working in this repo during the spec phase. Build-phase conventions come later.

## 1. How we talk

- We are two people discussing an idea. Conversational.
- Short replies. If a reply needs more than ~15 lines, lead with the one question or decision that matters and offer to go deeper.
- Ask one or two questions at a time. Batch only for trivial facts.
- Don't restate the brief back. Don't summarise what you're about to do.
- Options: give 2–3, one-line tradeoff each, and state your pick.

## 2. How we write docs

- A spec is readable in five minutes.
- Bullets over prose. Tables where they help. No filler, no preamble.
- Use terms from [docs/glossary.md](docs/glossary.md). Don't invent synonyms.
- Placeholders are explicit: `> TODO (spec phase): ...`
- Never present something undecided as decided. Raise it as an open question.
- Relative links only. Mermaid for diagrams.
- UI/UX sections reference [visual-direction](docs/design/visual-direction.md); don't invent styling.

## 3. Hard rules

- No application code, package files, lockfiles, CI or build config.
- One feature per worktree. Edit **only your own spec file** (plus new files you create — see §5).
- Settled decisions are in [ADRs](docs/architecture/adr/README.md). Don't contradict them; raise an open question or propose a superseding ADR.

## 4. Claiming a feature

1. Check the [spec index](docs/specs/README.md) and the spec's front matter.
2. In your worktree, set front matter: `owner: <your-worktree-name>`, `status: claimed`. Commit that change first.
3. Move status as you go: `claimed → draft → in-review`. Only the reviewer sets `complete`.

Front matter is the source of truth. The index table is updated by the integrator at merge (avoids merge conflicts).

## 5. Where to write

| You want to… | Do this |
|---|---|
| Specify your feature | Edit your spec in `docs/specs/` |
| Ask something local to your feature | Add a row to your spec's **Open questions** |
| Need something from another spec | Add an open question in **your** spec naming the other spec. Don't edit theirs. |
| Make a cross-cutting decision | Create `docs/architecture/adr/proposed-<slug>.md` (integrator numbers it at merge) |
| Add/change a glossary term | Open question in your spec: `Glossary: …` |
| Log a decision | Don't. Integrator appends to `decisions-log.md` at merge. |

## 6. Cross-linking

- Link specs by relative path and section anchor, e.g. from a spec: `[combat HP](combat-tracker.md#8-data-model)`.
- Reference ADRs by number and link, e.g. from a spec: `[ADR-0005](../architecture/adr/0005-server-authoritative-sync.md)`.
- Requirement IDs: `FR-<PREFIX>-NN` (prefix in each spec's front matter). Reference them across specs.
- Open question IDs: `OQ-<PREFIX>-NN`.

## 7. Raising an open question

Row in your spec's Open questions table:

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|

- `Blocking? = yes` if your spec can't reach `complete` without an answer.
- If it affects more than your spec → also draft a proposed ADR.

## 8. Definition of "spec complete"

- [ ] Every template section filled or explicitly marked N/A with a reason.
- [ ] No `TODO (spec phase)` left.
- [ ] Functional requirements numbered and each testable.
- [ ] DM view and player view both described.
- [ ] Data model lists entities, fields, relations, derived values.
- [ ] Every WS event lists its visibility rule.
- [ ] Disconnect, reconnect and server-crash behaviour stated.
- [ ] Test plan names fixtures and runs isolated per worktree ([ADR-0008](docs/architecture/adr/0008-parallel-dev-isolation.md)).
- [ ] No blocking open questions. Non-blocking ones have an owner.
- [ ] Consistent with all accepted ADRs and the glossary.
- [ ] Readable in five minutes.
