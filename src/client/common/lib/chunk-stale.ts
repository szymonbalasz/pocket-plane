// FR-SHELL-175 / -176 (BL-91): what counts as a stale chunk, the client-specific copy and the
// Reload guard. A page loaded before a rebuild asks for hashed chunks the rebuild deleted; the
// browser rejects the dynamic import with its chunk error. A reload always gets the new build
// (`index.html` is `no-cache`).

/** The browsers' dynamic-import failures (Chromium, Safari, Firefox) and Vite's CSS preload. */
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export function isChunkError(err: unknown): boolean {
  return err instanceof Error && CHUNK_ERROR.test(err.message);
}

/** A dynamic import that still failed with a chunk error after the retry (FR-SHELL-176). */
export class StaleChunkError extends Error {
  override name = "StaleChunkError";
  /** The chunk's base name without its hash (`TrayWindow`), "chunk" when the URL is unknown. */
  readonly chunk: string;
  constructor(readonly original: unknown) {
    const message = original instanceof Error ? original.message : String(original);
    super(message);
    this.chunk = chunkName(message);
  }
}

export const isStaleChunk = (err: unknown): err is StaleChunkError =>
  err instanceof StaleChunkError;

/** `…/assets/TrayWindow-B1x2c3D4.js` → `TrayWindow`. */
export function chunkName(message: string): string {
  const file = message.match(/\/([^/\s]+?)\.(?:m?js|css)\b/)?.[1];
  if (!file) return "chunk";
  return file.replace(/-[\w]{6,}$/, "") || "chunk";
}

export type ChunkClient = "dm" | "player";

/** The client from the URL (DM `/`, player `/p/<token>`), for code outside React. */
export function clientFromPath(path = globalThis.location?.pathname ?? "/"): ChunkClient {
  return path.startsWith("/p/") ? "player" : "dm";
}

/** FR-SHELL-175: the reload copy. */
export const staleCopy = (c: ChunkClient): string =>
  c === "dm" ? "Rebuild finished — reload" : "New version available — reload";

/** FR-SHELL-176: after a Reload that didn't help ("check with your DM": players only). */
export const failedCopy = (c: ChunkClient): string =>
  c === "dm"
    ? "Still failing — is the server on the new build?"
    : "Still failing — check with your DM";

/** A second Reload for the same chunk within this long doesn't reload again. */
export const RELOAD_GUARD_MS = 10_000;

const reloadKey = (chunk: string) => `pp.chunk-reload.v1.${chunk}`;

export interface ReloadEnv {
  now(): number;
  get(key: string): string | null;
  set(key: string, value: string): void;
  reload(): void;
}

const browserReloadEnv = (): ReloadEnv => ({
  now: () => Date.now(),
  get: (k) => {
    try {
      return globalThis.sessionStorage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      globalThis.sessionStorage?.setItem(k, v);
    } catch {
      // No storage (private mode): every press reloads.
    }
  },
  reload: () => globalThis.location?.reload(),
});

/**
 * FR-SHELL-176: Reload pressed for `chunk`. Within 10 s of the previous press (sessionStorage,
 * so it survives the reload) → "failed", no reload; else the press is stored and the page reloads.
 */
export function pressReload(
  chunk: string,
  env: ReloadEnv = browserReloadEnv(),
): "reloaded" | "failed" {
  const now = env.now();
  const last = Number(env.get(reloadKey(chunk)));
  if (Number.isFinite(last) && last > 0 && now - last < RELOAD_GUARD_MS) return "failed";
  env.set(reloadKey(chunk), String(now));
  env.reload();
  return "reloaded";
}
