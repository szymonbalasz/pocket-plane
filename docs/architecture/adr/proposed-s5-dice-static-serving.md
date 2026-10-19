# Proposed — Built client served precompressed and cached

- Status: proposed (sprint 5, track D; for DM gate 1)
- Date: 2026-10-18
- Amends: none (no earlier ADR covers how `start` serves `dist/client`; [ADR-0001](0001-tech-stack.md) stack and [ADR-0002](0002-single-package.md) single package kept)
- Affects: server core `src/server/app.ts`, tooling `vite.config.ts`, every client file a browser downloads; spec home [dice-extras FR-DICEX-52](../../specs/dice-extras.md#6-functional-requirements) (BL-21)

## Context

- BL-21: the 632,343 B `dice3d` chunk goes out uncompressed (≈ 13 s on a 400 kbit/s link), so the first roll after a reload falls back to chips.
- Probe 2026-10-18: `/assets/*` answers carry **no** `Content-Encoding`, `Cache-Control`, `ETag` or `Last-Modified`, so every reload downloads the whole client again.
- Hono 4.13.13 (installed) has `serveStatic({ precompressed: true })` (serves `.br` / `.zst` / `.gz` siblings) and `compress()` (gzip / deflate on the fly); Bun 1.3 has `node:zlib` brotli and gzip.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Precompress at build (`.br` q11 + `.gz` -9) and serve with `serveStatic({ precompressed: true })`** | Brotli `dice3d` 132,499 B (−79 %); 0 ms CPU per request; no dependency | Build +2.8 s; edits `vite.config.ts` and `app.ts` (shared) |
| B. Hono `compress()` on the fly | One line in `app.ts` | gzip only (162,622 B); 8–12 ms CPU per request on the DM's laptop |
| C. A Vite compression plugin (`vite-plugin-compression2`, MIT) | Ready-made | A dev dependency (DM OK) for the same zlib calls |

## Decision

**A** (proposed; dice-extras OQ-DICEX-40 A and caching OQ-DICEX-41 A, a scope flag beyond BL-21, both decided #256).

| Rule | Detail |
|---|---|
| Files | Every `.js` / `.css` ≥ 1 KB in `dist/client/assets/` gets `.br` and `.gz` siblings at `bun run build` (inline Vite plugin, `node:zlib`) |
| Encoding | `br`, else `gzip`, else the plain file, from `Accept-Encoding` |
| `Vary` | `Vary: Accept-Encoding` on every `/assets/*` answer, plain files too |
| Cache | `/assets/*` (content-hashed names) `public, max-age=31536000, immutable`; the HTML pages `/`, `/p/*` `no-cache` |
| Validators | None added; a new build changes the hashed names |
| Out of scope | Dev (Vite), REST, the asset store (`/api/assets/...`, already-compressed images) |

## Consequences

- Player first load 1,210,852 B → 321,999 B (brotli); DM 1,430,904 B → 373,390 B; a reload transfers 0 B for unchanged files.
- Proof runs in `bun run e2e` after its build (`FR-DICEX-52 compressed build output`): the unit build test uses `write: false` and never runs the hook.
- Whether Cloudflare's edge already compresses tunnel traffic is not verified; origin compression helps LAN play, other tunnels and throttled tests either way.
