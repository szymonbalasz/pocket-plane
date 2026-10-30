# 0074 — User-supplied compendium sources and replaced entries

- Status: accepted (DM, 2026-10-30, #395)
- Date: 2026-10-30
- Amends: [ADR-0046](0046-compendium-scope.md) (Import row: "bundled recorded source"), [compendium](../../specs/compendium.md) FR-CMP-06 ("repo files only"), FR-CMP-34 / -38 (search)
- Refines: [ADR-0015](0015-source-adapters-fixtures.md) (5etools: "user-supplied files only; nothing non-SRD bundled"), [ADR-0018](0018-global-imported-content.md) (global imports)
- Affects: [compendium-expansion](../../specs/post-mvp/compendium-expansion.md), [compendium](../../specs/compendium.md), [effect-modifiers](../../specs/effect-modifiers.md) (preset lookup), AGENTS §9.2 (`PP_5ETOOLS_DIR`)

## Context

- The DM owns books whose text 5etools carries; the repo is public, so none of it may be bundled or committed (ADR-0015).
- Today every compendium source is bundled in the repo and imported by key (FR-CMP-06, OQ-CMP-17).
- The DM's 5etools package (2014 build) is 90 MB of JSON plus 4 GB of images. Its entries repeat the SRD (323 monsters, 319 spells and 493 items flagged `srd`) and older books (275 monsters `reprintedAs`).
- DM pick (2026-10-30): one Goblin in search, the book's, not the SRD's too.

## Options

**Where the source lives**

| Option | Pros | Cons |
|---|---|---|
| **A. A folder the DM configures (`PP_5ETOOLS_DIR`), read at import; key → files on the server** | Nothing in the repo; one copy for every worktree; update = extract a new release | A source the repo can't test with real data (fixtures are invented) |
| B. Gitignored folder in the checkout | Relative path | One 8 GB copy per worktree; one bad `git add` publishes it |
| C. Upload through the browser | No config | 90 MB over the tunnel; a client-supplied file path into the pipeline |

**Duplicates across sources**

| Option | Pros | Cons |
|---|---|---|
| **1. `replaces` refs on the newer entry; replaced entries hidden from search, still readable by id** | Old references keep working; import order doesn't matter; works for reprints too | One more column; a derived hidden set per index build |
| 2. Show both with source badges | No change | Two Goblins, two Fireballs everywhere |
| 3. Delete or overwrite the SRD entry | One row | Breaks tokens, encounters, Rules pages; mixes sources |

## Decision

**A + 1** (DM, #395):

- A compendium source may be **user-supplied**: read at import time from a server-configured folder, never from the client, never bundled. `cmp.import` still takes only a source key. One source per 5etools book (`5et-<abbr>`).
- Nothing from a user-supplied source is committed, test fixtures included: fixtures use invented content in the source's format.
- An imported entry may **replace** other imported entries (`replaces: ["<source>:<sourceKey>"]`). Any entry replaced by an imported entry is left out of search, lists and lookups for every viewer; reads by id, definitions, tokens, encounters and Rules pages still resolve it. A replacing entry with no preset inherits the replaced one's.

## Consequences

- FR-CMP-06 gains "or a user-supplied folder source (ADR-0074)"; ADR-0046's Import row covers both.
- `compendium_entry.replaces` (JSON leaf, default `[]`): DB schema + data-model docs, orchestrator-assigned.
- `config.ts` gains optional `PP_5ETOOLS_DIR`; AGENTS §9.2 gains its row; `.env.example` a commented line.
- Search index (FR-CMP-34) computes the hidden set at build; the bench covers ≈ 7,600 rows.
- Licence: user-supplied sources carry no open licence; About credits name the book and "© Wizards of the Coast", for private table use.
- Token art (compendium-expansion X3, OQ-CMPX-01 A): imported definitions stay global and hold no asset; a monster entry carries the token's folder-relative `artPath`, and each campaign copies the file into its own assets on first placement (table `imported_art`, server-only), so ADR-0023's per-campaign capability rule is unchanged.
