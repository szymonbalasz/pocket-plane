# 0058 — Campaign feature switches (optional features, off by default)

- Status: accepted (DM gate, [#315](../../decisions-log.md))
- Date: 2026-10-20
- Refines: [ADR-0021](0021-sync-protocol-conventions.md) B (visibility fns read the record + connection context: the context gains the campaign's switches); [ADR-0016](0016-domain-events-pending-actions.md) unchanged (events and the event log as before)
- Affects: [campaign-management](../../specs/campaign-management.md) (FR-CAMP-38–45), [gems](../../specs/gems.md) (FR-GEM-01–05), [live-sync](../../specs/live-sync.md), [dice-roll-log](../../specs/dice-roll-log.md) (log kinds), protocol §26 registries
- Raised by: DM [#312](../../decisions-log.md) (gems optional, off by default; "likely a small campaign feature-flag ADR other optional features can reuse"); sprint 7 track GM

## Context

- #312: gems are a per-campaign switch, **off by default**; while off, no gem UI, counts, spend actions or log lines for anyone, and **nothing gem-related in snapshots**. Other homebrew / optional features will want the same (sprint-7 plan).
- ADR-0021 B: one visibility fn per record type, reading only the record and the connection context. A fn can't read the campaign row to ask "is gems on?".
- Log entries of every kind share one record type (`game-log-entry`); hiding a feature's lines needs a rule per **kind**, not per type.
- Client hiding alone fails #312: rows would still be in the snapshot and frames.
- CON-44: a never-used feature must cost 0 B.

## Options

| Option | Pros | Cons |
|---|---|---|
| A. One column per feature on `campaign` (`gems_enabled`) | Simplest SQL, typed | A schema change and a wire field per future feature; no common "off" rule |
| **B. `campaign.features` JSON leaf: the list of enabled keys from an append-only registry; the hub filters record types and log kinds tagged with a feature by the viewer's `features`** | One column for all features; 0 B while empty (omitted on the wire); one tested "off" rule; filters stay pure | A small `src/server/ws/` change (viewer context + tag check); a JSON leaf on a table that had none |
| C. A `campaign_feature` table (one row per enabled feature) | Normalised | Same wire and hub work as B plus a table, join and record type |
| D. Each feature's visibility fn / provider checks the campaign itself | No hub change | Breaks ADR-0021 B (fns read another record); every feature re-implements "off"; log kinds can't do it |

## Decision

> Undecided. Suggested pick **B**.

- **Registry** `src/shared/campaign-management/features.ts` (append-only, AGENTS §9.9): `{key, label, description, ownerSpec}`; `gems` first. Unknown key in an intent → `invalid`.
- **Storage:** `campaign.features` JSON leaf `string[]`, default `[]`. **Wire:** `CampaignRecord.features` present only when non-empty (0 B when off).
- **Switching:** `camp.setFeature {feature, on}` (DM, WS) → `campaign` upsert + event `CampaignFeatureSet {feature, on}` (logged, not undoable); same value → no-op, no event. After the commit **every connection of the campaign gets a fresh snapshot** (as a scene switch does for players, FR-SYNC-11), so rows appear / disappear in one step and per-connection state can't go stale. **Named exemption from ADR-0021** ("events carry changes for any record whose visibility changes"): a feature switch resyncs instead of listing those changes. A resync keeps client-only UI state (popup typed values, roll-bar drafts, held dice, open dialogs), as FR-SYNC-11's does.
- **Viewer context** gains `features: readonly string[]`, read from the campaign row when the connection's snapshot is built (connect, `resync`, the forced resync above). Visibility fns may read it; they still read nothing else.
- **What "off" means** (one rule, the hub applies it; features declare, never re-implement):

| Thing | Declared as | Off |
|---|---|---|
| Record type | `feature: "<key>"` on registration | Hidden for every viewer (DM too): no snapshot rows, no frame changes, no `sync.load` rows |
| Log kind | `feature: "<key>"` on the kind def (`kinds.ts`) | Entries of the kind hidden for every viewer; the window still counts them (ADR-0029 cut before the filter: a viewer may get < 100 entries, as with hidden entries today) |
| Intents | the command checks `featureOn(env, key)` first | `forbidden` "‹Label› is off in this campaign"; nothing written |
| Traces on other features' records (fields / rows a feature caused on a shared record) | `traces: {feature, hides?(record), strip: paths[]}` on that record type / log kind, pure (record + context) | `hides` true → row hidden; `strip` paths removed, for every viewer. Gems (OQ-GEM-21 B): `roll` entries with `supersededBy` hidden, `replaces` stripped; damage cards' `maxed` / `diceMaxed` stripped. (Under OQ-GEM-21 A gems declares no traces.) |
| Entries in other registries (notification kinds, rule / roll hooks, sheet sections, windows, routes) | `feature?` on the entry; server hooks call `featureOn`; client registries check `useFeature` | skipped / not rendered. No build now beyond what gems needs |
| Rows in the DB | — | **kept** (switching on restores them); a feature that wants a clear does it with its own command |
| Client UI | `useFeature(store, key)` from the `campaign` record | not rendered |

## Consequences

- Gems ship as the first feature: `character-gems` tagged `gems`; log kinds `gem.award`, `gem.spend` tagged `gems`; traces per the table (gems FR-GEM-05, OQ-GEM-21).
- **Leak rule for tests:** with a feature off, no snapshot, frame, `sync.load` ack or `stats.query` answer contains a tagged type, a tagged kind, a declared trace or the feature key; leak scans add the check per feature.
- **Every read path** (snapshot, frames, `sync.load`, `stats.query`) applies the hub's feature rule. Only the raw `event_log` ignores it (events of tagged commands are logged as usual), and no client read uses it.
- **CON-44** (measured 2026-10-20, heavy harness, throwaway probe): off **0 B**; switch on +20 B per viewer (`"features":["gems"]`); gems' own rows are in [gems §12](../../specs/gems.md#12-performance--bandwidth).
- Build: one shared-file slice (gems GM0): `src/server/db/schema.ts` (column), `src/server/ws/` (viewer `features`, tag and trace check in the visibility filter and `sync.load`), the record-type registration type (`feature?`), `LogKindDef.feature?` in `@shared/dice-roll-log/kind-types.ts`, the new registry; docs: protocol (§26 registries, viewer context), data model (campaign), live-sync (one FR at integration).
- A later feature adds: one registry line, its tags, its own `featureOn` checks. No new column, no ADR.
