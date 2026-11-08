// Animated tokens, playback (FR-ANIM-12, -13, -15), both clients: one muted, looping `<video>`
// per asset ID, shared by every node that shows it. A video plays while it has users and the tab
// is visible; with no users it pauses, and after RELEASE_MS it is dropped. URLs come only from
// asset IDs in records (ADR-0023). DOM-free core (the element factory is injected) for tests.
import { motionPath } from "@shared/assets-pipeline/video";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useSync } from "../../sync/store";

/** FR-ANIM-13: a video with no nodes for this long is released. */
export const RELEASE_MS = 60_000;

export type VideoState = "loading" | "ready" | "error";

/** What the pool needs of an `HTMLVideoElement`. */
export interface VideoLike {
  src: string;
  muted: boolean;
  loop: boolean;
  playsInline: boolean;
  preload: string;
  readonly paused: boolean;
  play(): Promise<void> | undefined;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, fn: () => void): void;
}

interface Entry<V> {
  video: V;
  state: VideoState;
  users: number;
  timer: unknown;
}

export interface PoolEnv<V> {
  make(): V;
  hidden(): boolean;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(h: unknown): void;
}

export class VideoPool<V extends VideoLike> {
  private entries = new Map<string, Entry<V>>();
  private listeners = new Map<string, Set<() => void>>();

  constructor(private env: PoolEnv<V>) {}

  /** Starts (or joins) `id`'s video; returns the release. */
  acquire(id: string): () => void {
    let e = this.entries.get(id);
    if (!e) e = this.create(id);
    if (e.timer !== null) {
      this.env.clearTimer(e.timer);
      e.timer = null;
    }
    e.users += 1;
    this.play(e);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release(id);
    };
  }

  state(id: string): VideoState | "none" {
    return this.entries.get(id)?.state ?? "none";
  }

  /** The element once it can play, else null. */
  element(id: string): V | null {
    const e = this.entries.get(id);
    return e?.state === "ready" ? e.video : null;
  }

  subscribe(id: string, fn: () => void): () => void {
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  /** The tab's visibility changed: hidden pauses all; visible resumes the used ones. */
  visibilityChanged(): void {
    for (const e of this.entries.values()) {
      if (this.env.hidden() || e.users === 0) e.video.pause();
      else this.play(e);
    }
  }

  /** FR-ANIM-15: after a reconnect snapshot, failed videos load once more. */
  retryErrors(): void {
    for (const [id, e] of [...this.entries]) {
      if (e.state !== "error") continue;
      const users = e.users;
      this.drop(id);
      if (users > 0) {
        const fresh = this.create(id);
        fresh.users = users;
        this.play(fresh);
      }
      this.emit(id);
    }
  }

  /** Test hook: live entries. */
  size(): number {
    return this.entries.size;
  }

  private create(id: string): Entry<V> {
    const video = this.env.make();
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    const e: Entry<V> = { video, state: "loading", users: 0, timer: null };
    video.addEventListener("canplay", () => {
      if (this.entries.get(id) !== e || e.state === "ready") return;
      e.state = "ready";
      this.emit(id);
    });
    video.addEventListener("error", () => {
      if (this.entries.get(id) !== e) return;
      e.state = "error";
      video.removeAttribute("src");
      this.emit(id);
    });
    this.entries.set(id, e);
    video.src = motionPath(id);
    return e;
  }

  private play(e: Entry<V>): void {
    if (e.state === "error" || e.users === 0 || this.env.hidden() || !e.video.paused) return;
    // Autoplay of a muted video is allowed; a refusal leaves the still frame showing.
    e.video.play()?.catch(() => {});
  }

  private release(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.users = Math.max(0, e.users - 1);
    if (e.users > 0) return;
    e.video.pause();
    e.timer = this.env.setTimer(() => {
      if (this.entries.get(id) === e && e.users === 0) {
        this.drop(id);
        this.emit(id);
      }
    }, RELEASE_MS);
  }

  private drop(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.timer !== null) this.env.clearTimer(e.timer);
    e.video.pause();
    e.video.removeAttribute("src");
    e.video.load();
    this.entries.delete(id);
  }

  private emit(id: string): void {
    for (const fn of [...(this.listeners.get(id) ?? [])]) fn();
  }
}

let page: VideoPool<HTMLVideoElement> | null = null;

/** The page's pool (created on first use; listens for tab visibility). */
export function videoPool(): VideoPool<HTMLVideoElement> {
  if (page) return page;
  const pool = new VideoPool<HTMLVideoElement>({
    make: () => document.createElement("video"),
    hidden: () => typeof document !== "undefined" && document.hidden,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => pool.visibilityChanged());
  }
  page = pool;
  return pool;
}

const noop = () => {};

/**
 * React: `id`'s playing video while `enabled`, else null (draw the still). Null too while it
 * loads or after an error (FR-ANIM-12, -15). Retries failed videos after a reconnect snapshot.
 */
export function useAssetVideo(
  id: string | null | undefined,
  enabled: boolean,
): HTMLVideoElement | null {
  const key = enabled && id ? id : null;
  const state = useSync((s) => s.state);
  const prev = useRef(state);
  useEffect(() => {
    if (state === "live" && prev.current !== "live" && key) videoPool().retryErrors();
    prev.current = state;
  }, [state, key]);
  useEffect(() => (key ? videoPool().acquire(key) : undefined), [key]);
  const subscribe = useCallback(
    (fn: () => void) => (key ? videoPool().subscribe(key, fn) : noop),
    [key],
  );
  const get = useCallback(() => (key ? videoPool().state(key) : "none"), [key]);
  const s = useSyncExternalStore(subscribe, get, get);
  return key && s === "ready" ? videoPool().element(key) : null;
}
