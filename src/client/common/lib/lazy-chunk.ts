// FR-SHELL-176 (BL-91): the one loader every dynamic `import()` / `lazy(` in `src/client` goes
// through (the scan in `lazy-chunk.test.ts` fails on a bare site). A chunk error is retried once
// after 500 ms, then classified stale (`StaleChunkError`); any other error is rethrown as is.
// No handler prevents `vite:preloadError`, so the import itself rejects and picks the fallback.
import { type ComponentType, createElement, lazy, type ReactNode } from "react";
import { ChunkBoundary, type ChunkFallback, showStaleNotice } from "./chunk-reload";
import { isChunkError, StaleChunkError } from "./chunk-stale";

export const CHUNK_RETRY_MS = 500;

export interface LoadChunkOptions {
  /** Show the page's stale notice when it fails stale (a part with no panel of its own). */
  notice?: boolean;
  /** Tests only. */
  retryMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function loadChunk<M>(
  factory: () => Promise<M>,
  opts: LoadChunkOptions = {},
): Promise<M> {
  try {
    return await factory();
  } catch (err) {
    if (!isChunkError(err)) throw err;
  }
  await sleep(opts.retryMs ?? CHUNK_RETRY_MS);
  try {
    return await factory();
  } catch (err) {
    if (!isChunkError(err)) throw err;
    const stale = new StaleChunkError(err);
    if (opts.notice) showStaleNotice(stale.chunk);
    throw stale;
  }
}

type PropsOf<C extends (props: never) => ReactNode> =
  Parameters<C> extends [] ? object : Parameters<C>[0] & object;

/**
 * A lazy component over `loadChunk`; a stale chunk draws `fallback` in its place (play-shell §14
 * site list). Keep the site's own `Suspense` around it.
 */
export function lazyChunk<C extends (props: never) => ReactNode>(
  factory: () => Promise<{ default: C }>,
  fallback: ChunkFallback,
  opts: Omit<LoadChunkOptions, "notice"> = {},
): (props: PropsOf<C>) => ReactNode {
  type P = PropsOf<C>;
  const load = () => loadChunk(factory, { ...opts, notice: fallback === "notice" });
  const Lazy = lazy(load as unknown as () => Promise<{ default: ComponentType<P> }>);
  function Chunk(props: P) {
    const children = createElement(Lazy, props);
    return createElement(ChunkBoundary, { fallback, children });
  }
  return Chunk;
}
