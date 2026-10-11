# Gate — Phase 1 (foundation specs + build conventions)

Scratch for the DM review. Specs are on `main` at `in-review`; conventions are on branch `spec/build-conventions` (unmerged).

## Summaries

| Item | Summary | Reviewer verdict |
|---|---|---|
| [live-sync](../specs/live-sync.md) | 35 FRs. First-frame `hello` auth, heartbeat, auto-reconnect, generic record-change events, one visibility fn per record type (hidden by default), snapshot on (re)connect, DM-only presence, test-only "sync probe" record to prove filtering in Phase 2. Proposed ADR: sync protocol conventions. | Solid on reconnect/crash. Conflicts with CAMP (campaign switch, inactive-campaign close code), probe walkthrough contradicts its own rule, 338 lines (too long). |
| [campaign-management](../specs/campaign-management.md) | 29 FRs. DM secret from env only, player link = opaque path token + configured public base URL, one active campaign, soft-remove player, rename. Proposed ADRs: auth credentials, single active campaign. | Remove = revoke + kick (tier F). Multi-campaign + switching + waiting screen not tier S. Named events contradict SYNC-07. Fixture names clash with FIX. ~290 lines. |
| [fixtures-adapters](../specs/fixtures-adapters.md) | 26 FRs. reset / load / reset-and-load, TS-module fixtures, in-process loader with DM authority, seeded IDs + fixed clock, pipeline core (validate → upsert → provenance), session-sim target table with owners per phase. Proposed ADR: deterministic seams. | Fixture names clash with CAMP; load-while-running conflicts with SYNC; seeded mode needs a "disposable data only" guard; some scope beyond tier S (re-import, layered loads, list). 293 lines. |
| Build conventions (AGENTS.md §9) | Layout `src/{server,shared,client/{common,dm,player}}`, aliases, `PP_*` env, per-worktree port slots (4100 + 10×slot) with dev/verify/e2e profiles, `fixtures/` + `fixtures:reset|load|reset-load`, `data-testid` scheme, evidence in `.verify/<run-id>/`, done checklist, shared-file rules. | No ADR contradictions. Gaps: skeleton exception for shared files, reset safety flag, ID seam, Windows port/SQLite details, bun-only scripts. Slightly heavy (e2e fixed ports, verify via Vite). |

## DM decisions

### D1 — Campaigns in MVP
| Option | Tradeoff |
|---|---|
| **A. One campaign, no switching** (pick) | Created on first run by the DM (or by fixture). Data still scoped by `campaignId`. Cuts switching, waiting screen, the single-active ADR, and the SYNC/CAMP conflict |
| B. Many campaigns + switching (as specced) | Not tier S; needs reconnect-on-switch and a retryable close code |

### D2 — Removing a player
| Option | Tradeoff |
|---|---|
| **A. No remove in MVP; add + rename only** (pick) | Consistent with tier F (no revoke/kick). Typos fixed by rename |
| B. Soft remove as specced | Effectively revoke + kick |

### D3 — Tooling outside ADR-0001 (needs your OK)
| Need | Pick | Alternatives |
|---|---|---|
| Typecheck | **TypeScript `tsc --noEmit`** | tsgo preview |
| Lint/format | **Biome** | ESLint + Prettier; oxlint + Prettier |
| Test-agent browser | **Playwright MCP** (one isolated context per role) | Agent-written Playwright scripts; Chrome DevTools MCP |
| Fixture images | **Committed SVGs, rasterised with sharp at load** (no new dep) | Tiny committed PNGs; generated in code |

### D4 — Accept the remaining blocking picks as written
| ID | Pick |
|---|---|
| OQ-SYNC-01 | One visibility fn per record type: send whole / redact fields / drop |
| OQ-SYNC-03 | DM snapshot = whole campaign; player = campaign data + active scene; scene switch resyncs players |
| OQ-SYNC-04 | Live-play intents over WS; CRUD/uploads via Hono RPC; same command layer |
| OQ-SYNC-07 | Generic record changes `{type, id, op, data}` + cause; one client reducer |
| OQ-SYNC-09 | First WS frame `hello` carries the credential |
| OQ-CAMP-01 | Opaque token in link path; links built from configured public base URL; DM re-copies when tunnel host changes |
| OQ-CAMP-03 | DM secret from env only (min 12 chars), never stored (changes earlier pick "hashed in DB") |
| OQ-CAMP-10 | DM client keeps secret in localStorage, sends per request + in `hello`; player token stays in URL |
| OQ-FIX-02 | Fixtures are TypeScript modules |
| OQ-FIX-08 | CLI reset-and-load `session-sim` ≤ 3 s; in-process ≤ 1 s |
| OQ-FIX-09 | Loader calls the command layer in-process with DM authority (no HTTP) |
| OQ-FIX-12 | Seeded IDs/tokens + fixed clock during load — **only** when data dir is flagged disposable |
| OQ-FIX-14 | Imported definitions keyed `(campaign, source, sourceKey)` — refines ADR-0015's `(source, sourceKey)` |

Non-blocking defaults I'll keep unless you object: DM-only presence list (near-free), rename player, test-only sync probe, glossary additions (signal, presence, resync, record change, fixture bundle, load manifest, public base URL), CLI refuses fixture load while the server runs.

## Resolved by integrator (no DM call needed)

- Fixture names: fixtures-adapters owns them; CAMP and SYNC align (`player-1` = player, character named separately).
- CAMP events use SYNC's generic record changes.
- Signals (ping/laser) are not domain events; they bypass the bus.
- Invalid-link screen wording owned by CAMP.
- Length: envelopes, close codes and limits move to `docs/protocol` at consolidation; specs trimmed to ~5 min.
- Orchestrator builder brief wording fixed to match ADR-0016 (log append in the same transaction, then dispatch).

## Next after your answers

Fresh revision agents (one per spec + conventions) apply D1–D4 and the review findings → I re-check → you set `complete` → consolidation → Phase 2 skeleton.
