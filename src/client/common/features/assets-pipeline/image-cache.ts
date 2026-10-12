// Image loader core (FR-ASSET-16): one load per URL shared by every consumer; `error` loads
// retry once after the next reconnect snapshot. DOM-free so it runs under `bun test`.

export type ImageState = "loading" | "ready" | "error";

/** The subset of HTMLImageElement the cache uses. */
export interface LoadableImage {
  src: string;
  onload: ((this: never, ev: never) => unknown) | null;
  onerror: ((this: never, ev: never) => unknown) | null;
}

export interface CacheEntry<I extends LoadableImage> {
  url: string;
  state: ImageState;
  image: I;
  /** Retries after a reconnect so far (max 1). */
  retries: number;
}

export class ImageCache<I extends LoadableImage> {
  private entries = new Map<string, CacheEntry<I>>();
  private listeners = new Map<string, Set<() => void>>();

  constructor(private readonly create: () => I) {}

  /** The entry for `url`, starting its load on first use. */
  get(url: string): CacheEntry<I> {
    let e = this.entries.get(url);
    if (!e) {
      e = { url, state: "loading", image: this.create(), retries: 0 };
      this.entries.set(url, e);
      this.start(e);
    }
    return e;
  }

  peek(url: string): CacheEntry<I> | undefined {
    return this.entries.get(url);
  }

  subscribe(url: string, fn: () => void): () => void {
    let set = this.listeners.get(url);
    if (!set) {
      set = new Set();
      this.listeners.set(url, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  /** After a reconnect snapshot: every `error` entry not yet retried loads once more. */
  retryErrors(): void {
    for (const e of this.entries.values()) {
      if (e.state !== "error" || e.retries >= 1) continue;
      e.retries += 1;
      // A fresh element: some browsers don't refire for the same element and src.
      e.image = this.create();
      this.set(e, "loading");
      this.start(e);
    }
  }

  /**
   * A later record change carries this asset again (e.g. a scene switch or a token update):
   * re-arm a failed load. Only `error` entries reload; returns true if a load started.
   */
  retry(url: string): boolean {
    const e = this.entries.get(url);
    if (!e || e.state !== "error") return false;
    e.image = this.create();
    this.set(e, "loading");
    this.start(e);
    return true;
  }

  private start(e: CacheEntry<I>): void {
    const img = e.image;
    img.onload = () => {
      if (e.image === img) this.set(e, "ready");
    };
    img.onerror = () => {
      if (e.image === img) this.set(e, "error");
    };
    img.src = e.url;
  }

  private set(e: CacheEntry<I>, state: ImageState): void {
    e.state = state;
    for (const fn of this.listeners.get(e.url) ?? []) fn();
  }
}
