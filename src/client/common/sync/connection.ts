// Client side of live-sync: hello, heartbeat, auto-reconnect, store, intents (SYNC §6, §7).
// No feature logic: features read records from the store and send intents.
import { CloseCode } from "@shared/protocol/codes";
import {
  CLIENT_CHECK_INTERVAL_MS,
  CLIENT_DROP_FLOOR_MS,
  CLIENT_PONG_TIMEOUT_MS,
  CLIENT_WAKE_DRIFT_MS,
  type Credential,
  type EventFrame,
  PING_INTERVAL_MS,
  ServerFrame,
  type ServerSignalFrame,
  WS_PATH,
  WS_PROBE_PARAM,
} from "@shared/protocol/frames";
import {
  applyLoad,
  idChunks,
  idsToRequest,
  isLoaded,
  type LazyState,
  LoadResult,
  lazyAfterSnapshot,
  markLoaded,
  SYNC_LOAD,
  unmark,
  wholeToRequest,
} from "@shared/protocol/lazy";
import {
  dropTypes,
  LoadSceneResult,
  mergeRecords,
  type SceneWindowState,
  SYNC_LOAD_SCENE,
  samePair,
  sceneWindowAfterSnapshot,
  type ViewAsPair,
  type ViewAsState,
  viewAsAfterSnapshot,
} from "@shared/protocol/scene-window";
import { applyEvent, applySnapshot, emptyStore, type RecordStore } from "@shared/protocol/store";
import { backoffDelay } from "./backoff";

export type ConnState = "connecting" | "live" | "reconnecting" | "waiting" | "rejected";

/** Incoming signal; `from` is server-stamped (ADR-0026). Receivers filter by scene themselves. */
export type SignalHandler = (s: ServerSignalFrame) => void;

/**
 * An applied `event` frame (with its `cause`) and the store after it. Never called for a
 * snapshot, a resync or a frame dropped for a seq gap (features react to live events only).
 */
export type EventHandler = (f: EventFrame, store: RecordStore) => void;

export class IntentRejected extends Error {
  override name = "IntentRejected";
  constructor(
    readonly code: string,
    message: string,
    readonly issues?: unknown[],
  ) {
    super(message);
  }
}

export interface Clock {
  /** Epoch ms (`notLiveSince`). */
  now(): number;
  /** Monotonic ms for the heartbeat (FR-SYNC-40, `performance.now`); defaults to `now`. */
  mono?(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}

const browserClock: Clock = {
  now: () => Date.now(),
  mono: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as number),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as number),
};

export interface SyncSnapshot {
  state: ConnState;
  store: RecordStore;
  /** Epoch ms when the connection last stopped being live; null while live or never live. */
  notLiveSince: number | null;
  everLive: boolean;
  /**
   * DM active-scene window (ADR-0041): scenes whose flagged rows the store holds in full (the
   * snapshot's active scene + loaded ones) and loads in flight. Reset by every snapshot.
   */
  scenes: SceneWindowState;
  /**
   * DM View as (FR-FOG-43): the one loaded `(sceneId, playerId)` pair of `view-as` rows and the
   * load in flight. Reset by every snapshot (the caller reloads if View as is still on).
   */
  viewAs: ViewAsState;
  /**
   * Lazy types (ADR-0045, FR-SYNC-35): loaded / in-flight / failed `sync.load`s of this snapshot
   * generation. Reset by every snapshot, which also drops every lazy row (FR-SYNC-37). Consumers
   * decide "is it there" with `isLoaded`, never by presence in the store.
   */
  lazy: LazyState;
}

export interface ConnectionOptions {
  credential: Credential;
  /** Defaults to same-origin `/ws`. */
  url?: string;
  clock?: Clock;
  onChange(s: SyncSnapshot): void;
  createSocket?: (url: string) => WebSocket;
  /** Subscribe to "worth retrying now" signals; returns an unsubscribe. Default: browser events. */
  onWake?: (fn: () => void) => () => void;
  /** Is the WS endpoint reachable? Default: `httpProbe`. May answer synchronously (tests). */
  probe?: (url: string) => Promise<boolean> | boolean;
  /** Subscribe to "the link is gone" (FR-SYNC-40); returns an unsubscribe. Default: `offline`. */
  onOffline?: (fn: () => void) => () => void;
}

const PROBE_TIMEOUT_MS = 2_000;

/**
 * Reachability probe: a plain HTTP `GET <ws path>?probe=1`, which the server answers 204
 * (protocol §3.1; a 2xx, so the browser logs nothing). A dead server gives a network error, the
 * dev proxy a 5xx. Why: Chromium throttles new WebSockets per renderer by recent *WebSocket*
 * failures (`services/network/websocket_throttler.cc`: up to +5 s per connect after ~16
 * failures/success). Probing with fetch during an outage keeps WS failures at one per outage
 * (FR-SYNC-05).
 */
export function probeUrl(wsUrl: string): string {
  const u = new URL(wsUrl.replace(/^ws/, "http"));
  u.searchParams.set(WS_PROBE_PARAM, "1");
  return u.toString();
}

export async function httpProbe(wsUrl: string): Promise<boolean> {
  try {
    const r = await fetch(probeUrl(wsUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return r.status === 204;
  } catch {
    return false;
  }
}

/** `online`, window focus, page show and the tab becoming visible. */
function browserWake(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onVisible = () => {
    if (document.visibilityState === "visible") fn();
  };
  for (const t of ["online", "focus", "pageshow"]) window.addEventListener(t, fn);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    for (const t of ["online", "focus", "pageshow"]) window.removeEventListener(t, fn);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

function browserOffline(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("offline", fn);
  return () => window.removeEventListener("offline", fn);
}

export function defaultWsUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}${WS_PATH}`;
}

export class SyncConnection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: unknown = null;
  private pingTimer: unknown = null;
  /** Heartbeat (FR-SYNC-40), monotonic ms: last frame of any kind, last check, pings. */
  private lastFrameAt = 0;
  private lastCheckAt = 0;
  private lastPingAt = 0;
  /** The ping / probe awaiting any frame back; null when none is outstanding. */
  private pingSentAt: number | null = null;
  private missedPongs = 0;
  /** The current socket reached `onopen` (a drop before it counts as a failed open). */
  private opened = false;
  private stopped = false;
  /** WS attempts since the last open that never reached `onopen`; > 0 → probe before the next. */
  private failedOpens = 0;
  /** Bumped on stop and on every new attempt; a stale probe result is ignored. */
  private generation = 0;
  private probing = false;
  private pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>();
  /** Bumped by every snapshot; a load answered for an older one is dropped. */
  private epoch = 0;
  private signalHandlers = new Set<SignalHandler>();
  private eventHandlers = new Set<EventHandler>();
  private snap: SyncSnapshot = {
    state: "connecting",
    store: emptyStore(),
    notLiveSince: null,
    everLive: false,
    scenes: { loaded: [], loading: [] },
    viewAs: viewAsAfterSnapshot(),
    lazy: lazyAfterSnapshot(0),
  };
  private readonly clock: Clock;
  private wakeOff: (() => void) | null = null;
  private offlineOff: (() => void) | null = null;

  constructor(private readonly opts: ConnectionOptions) {
    this.clock = opts.clock ?? browserClock;
  }

  get snapshot(): SyncSnapshot {
    return this.snap;
  }

  start(): void {
    this.stopped = false;
    this.wakeOff = (this.opts.onWake ?? browserWake)(() => this.retryNow());
    this.offlineOff = (this.opts.onOffline ?? browserOffline)(() => this.dropSocket());
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.probing = false;
    this.wakeOff?.();
    this.wakeOff = null;
    this.offlineOff?.();
    this.offlineOff = null;
    this.clearTimers();
    this.ws?.close(1000);
    this.ws = null;
  }

  /**
   * Skip the remaining backoff wait and reconnect now. Called when the browser reports it is
   * back online or the tab regains focus / becomes visible (live-sync §3 reconnect goal).
   * No-op while live, rejected, stopped or while an attempt is already in flight.
   */
  retryNow(): void {
    if (this.stopped || this.ws !== null || this.retryTimer === null) return;
    if (this.snap.state === "live" || this.snap.state === "rejected") return;
    this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.reconnect();
  }

  /** Test-mode "drop connection" button (FR-SYNC-27): a client-side drop; reconnects. */
  drop(): void {
    this.ws?.close(4999, "dropped by user");
  }

  /** Resolves on `ack`, rejects on `reject` or a disconnect (never resent, FR-SYNC-05). */
  sendIntent(name: string, payload: unknown): Promise<unknown> {
    if (this.snap.state !== "live" || !this.ws) {
      return Promise.reject(new IntentRejected("offline", "Not connected"));
    }
    const intentId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(intentId, { resolve, reject });
      this.ws?.send(JSON.stringify({ type: "intent", intentId, name, payload }));
    });
  }

  /**
   * DM: load a scene's flagged rows with `sync.loadScene` (ADR-0041). The ack's records are
   * merged into the store in frame order (synchronously, before the next frame). Returns null
   * when nothing is sent: not live, not the DM (players hold their scene in full), or the scene
   * is already loaded or loading (one load in flight per scene). A reject leaves the scene
   * unloaded; the caller toasts and retries on the next view.
   */
  loadScene(sceneId: string): Promise<void> | null {
    const { scenes, state, store } = this.snap;
    if (state !== "live" || !this.ws || store.you?.role !== "dm") return null;
    if (scenes.loaded.includes(sceneId) || scenes.loading.includes(sceneId)) return null;
    const epoch = this.epoch;
    const intentId = crypto.randomUUID();
    this.set({ scenes: { ...scenes, loading: [...scenes.loading, sceneId] } });
    return new Promise((resolve, reject) => {
      const done = (loaded: boolean, patch: Partial<SyncSnapshot> = {}) => {
        if (epoch !== this.epoch) return;
        const s = this.snap.scenes;
        this.set({
          ...patch,
          scenes: {
            loaded: loaded && !s.loaded.includes(sceneId) ? [...s.loaded, sceneId] : s.loaded,
            loading: s.loading.filter((x) => x !== sceneId),
          },
        });
      };
      this.pending.set(intentId, {
        resolve: (result) => {
          const parsed = LoadSceneResult.safeParse(result);
          if (!parsed.success) {
            done(false);
            reject(new IntentRejected("invalid", "Bad scene load result"));
            return;
          }
          done(true, { store: mergeRecords(this.snap.store, parsed.data.records) });
          resolve();
        },
        reject: (err) => {
          done(false);
          reject(err);
        },
      });
      this.ws?.send(
        JSON.stringify({ type: "intent", intentId, name: SYNC_LOAD_SCENE, payload: { sceneId } }),
      );
    });
  }

  /**
   * DM View as (FR-FOG-43): load player `playerId`'s `view-as` rows of `sceneId` with
   * `sync.loadScene {sceneId, viewAs}`. The ack replaces the previous pair's rows (every row of
   * the `view-as` types it lists) in frame order. One load in flight: a new pair supersedes it
   * (the older ack is dropped). Returns null when nothing is sent: not live, not the DM, or the
   * pair is already loaded or loading. A reject leaves no pair loaded; the caller toasts.
   */
  loadViewAs(sceneId: string, playerId: string): Promise<void> | null {
    const { viewAs, state, store } = this.snap;
    if (state !== "live" || !this.ws || store.you?.role !== "dm") return null;
    const pair: ViewAsPair = { sceneId, playerId };
    if (samePair(viewAs.loaded, pair) || samePair(viewAs.loading, pair)) return null;
    const epoch = this.epoch;
    const intentId = crypto.randomUUID();
    this.set({ viewAs: { ...viewAs, loading: pair } });
    const current = () => epoch === this.epoch && samePair(this.snap.viewAs.loading, pair);
    return new Promise((resolve, reject) => {
      this.pending.set(intentId, {
        resolve: (result) => {
          if (!current()) return resolve();
          const parsed = LoadSceneResult.safeParse(result);
          if (!parsed.success) {
            this.set({ viewAs: { ...this.snap.viewAs, loading: null } });
            reject(new IntentRejected("invalid", "Bad view-as load result"));
            return;
          }
          const types = Object.keys(parsed.data.records);
          const dropped = dropTypes(this.snap.store, [...this.snap.viewAs.types, ...types]);
          this.set({
            store: mergeRecords(dropped, parsed.data.records),
            viewAs: { loaded: pair, loading: null, types },
          });
          resolve();
        },
        reject: (err) => {
          if (current()) this.clearViewAs();
          reject(err);
        },
      });
      this.ws?.send(
        JSON.stringify({
          type: "intent",
          intentId,
          name: SYNC_LOAD_SCENE,
          payload: { sceneId, viewAs: playerId },
        }),
      );
    });
  }

  /**
   * Lazy types (ADR-0045, FR-SYNC-35): `sync.load` a whole type (`ids` undefined) or ids. An id
   * load requests only ids not yet loaded, in flight or failed (a whole-type load covers every
   * id), in chunks of ≤ 50, one load in flight per chunk. Each ack replaces the type's rows /
   * those ids in frame order and marks them loaded; a reject marks them failed (not retried
   * until `retryLoad` or the next snapshot). An answer for an older snapshot generation is
   * dropped. Returns null when nothing is sent (not live, or nothing left to request).
   */
  load(type: string, ids?: readonly string[]): Promise<void> | null {
    const { state, lazy } = this.snap;
    if (state !== "live" || !this.ws) return null;
    if (ids === undefined) return wholeToRequest(lazy, type) ? this.sendLoad(type) : null;
    const want = idsToRequest(lazy, type, ids);
    if (want.length === 0) return null;
    return Promise.all(idChunks(want).map((chunk) => this.sendLoad(type, chunk))).then(() => {});
  }

  /** Clears the failed mark of `type` / `ids` and loads them again (FR-SYNC-35 retry). */
  retryLoad(type: string, ids?: readonly string[]): Promise<void> | null {
    const { lazy } = this.snap;
    const failed = ids === undefined ? unmark(lazy.failed, type) : unmark(lazy.failed, type, ids);
    // A failed whole-type load also covers the ids; retrying ids clears it too.
    const cleared = ids === undefined ? failed : unmark(failed, type);
    if (cleared !== lazy.failed) this.set({ lazy: { ...lazy, failed: cleared } });
    return this.load(type, ids);
  }

  /** Whether `type` (or one id of it) is loaded in this snapshot generation. */
  isLoaded(type: string, id?: string): boolean {
    return isLoaded(this.snap.lazy.loaded, type, id);
  }

  private sendLoad(type: string, ids?: string[]): Promise<void> {
    const generation = this.snap.lazy.generation;
    const intentId = crypto.randomUUID();
    const current = () => generation === this.snap.lazy.generation;
    const lazy = this.snap.lazy;
    this.set({ lazy: { ...lazy, loading: markLoaded(lazy.loading, type, ids) } });
    return new Promise((resolve, reject) => {
      const fail = (err: Error) => {
        if (current()) {
          // A disconnect is no reject: left unloaded, the next snapshot's generation reloads.
          const rejected = !(err instanceof IntentRejected && err.code === "disconnected");
          const l = this.snap.lazy;
          this.set({
            lazy: {
              ...l,
              loading: unmark(l.loading, type, ids),
              failed: rejected ? markLoaded(l.failed, type, ids) : l.failed,
            },
          });
        }
        reject(err);
      };
      this.pending.set(intentId, {
        resolve: (result) => {
          if (!current()) return resolve();
          const parsed = LoadResult.safeParse(result);
          if (!parsed.success) return fail(new IntentRejected("invalid", "Bad load result"));
          const l = this.snap.lazy;
          this.set({
            store: applyLoad(this.snap.store, type, ids, parsed.data.records),
            lazy: {
              ...l,
              loaded: markLoaded(l.loaded, type, ids),
              loading: unmark(l.loading, type, ids),
            },
          });
          resolve();
        },
        reject: fail,
      });
      const payload = ids === undefined ? { type } : { type, ids };
      this.ws?.send(JSON.stringify({ type: "intent", intentId, name: SYNC_LOAD, payload }));
    });
  }

  /** FR-FOG-43: View as off: drops the loaded pair's rows (and any load in flight). */
  clearViewAs(): void {
    const { viewAs, store } = this.snap;
    if (viewAs.loaded === null && viewAs.loading === null && viewAs.types.length === 0) return;
    this.set({ store: dropTypes(store, viewAs.types), viewAs: viewAsAfterSnapshot() });
  }

  /**
   * Send a transient signal (FR-SYNC-22). Fire-and-forget: no ack, never queued or resent.
   * Returns false when not live (dropped).
   */
  sendSignal(name: string, data: unknown): boolean {
    if (this.snap.state !== "live" || !this.ws) return false;
    this.ws.send(JSON.stringify({ type: "signal", name, data }));
    return true;
  }

  /** Subscribe to incoming signals of every name; returns an unsubscribe. */
  onSignal(fn: SignalHandler): () => void {
    this.signalHandlers.add(fn);
    return () => {
      this.signalHandlers.delete(fn);
    };
  }

  /** Subscribe to applied event frames (see `EventHandler`); returns an unsubscribe. */
  onEvent(fn: EventHandler): () => void {
    this.eventHandlers.add(fn);
    return () => {
      this.eventHandlers.delete(fn);
    };
  }

  private set(patch: Partial<SyncSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.opts.onChange(this.snap);
  }

  private open(): void {
    if (this.stopped) return;
    const url = this.opts.url ?? defaultWsUrl();
    const ws = this.opts.createSocket ? this.opts.createSocket(url) : new WebSocket(url);
    this.ws = ws;
    this.opened = false;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.opened = true;
      this.failedOpens = 0;
      ws.send(JSON.stringify({ type: "hello", credential: this.opts.credential }));
      const now = this.mono();
      this.lastFrameAt = now;
      this.lastCheckAt = now;
      this.lastPingAt = now;
      this.pingSentAt = null;
      this.missedPongs = 0;
      this.pingTimer = this.clock.setInterval(() => this.heartbeat(), CLIENT_CHECK_INTERVAL_MS);
    };
    ws.onmessage = (e) => {
      if (this.ws === ws) this.onFrame(String(e.data));
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      if (!this.opened) this.failedOpens += 1;
      this.onClose(e.code);
    };
  }

  private mono(): number {
    return this.clock.mono ? this.clock.mono() : this.clock.now();
  }

  private ping(now: number): void {
    this.lastPingAt = now;
    this.pingSentAt = now;
    this.ws?.send(JSON.stringify({ type: "ping" }));
  }

  /**
   * FR-SYNC-40, every 1 s: a ping every 10 s; no frame within 5 s of a ping → one probe ping;
   * dropped after both are missed and ≥ 10 s since the last frame. A check > 2 s late (stall,
   * throttled tab, laptop wake, a big frame being handled) is a wake-up: deadlines restart.
   */
  private heartbeat(): void {
    if (this.ws?.readyState !== 1) return; // WebSocket.OPEN
    const now = this.mono();
    const drift = now - this.lastCheckAt - CLIENT_CHECK_INTERVAL_MS;
    this.lastCheckAt = now;
    if (drift > CLIENT_WAKE_DRIFT_MS) {
      this.lastFrameAt = now;
      this.missedPongs = 0;
      this.ping(now);
      return;
    }
    if (this.pingSentAt !== null && now - this.pingSentAt >= CLIENT_PONG_TIMEOUT_MS) {
      this.missedPongs += 1;
      this.pingSentAt = null;
      if (this.missedPongs < 2) this.ping(now);
    }
    if (this.missedPongs >= 2 && now - this.lastFrameAt >= CLIENT_DROP_FLOOR_MS) {
      this.dropSocket();
      return;
    }
    if (
      this.pingSentAt === null &&
      this.missedPongs === 0 &&
      now - this.lastPingAt >= PING_INTERVAL_MS
    ) {
      this.ping(now);
    }
  }

  /**
   * FR-SYNC-40 dropped (`offline`, or a silent link): detach the socket so its late `onclose`
   * and frames are ignored, close it best-effort and reconnect on the backoff (FR-SYNC-05).
   */
  private dropSocket(): void {
    const ws = this.ws;
    if (!ws || this.stopped) return;
    if (!this.opened) this.failedOpens += 1;
    this.ws = null;
    try {
      ws.close(4998, "dropped");
    } catch {
      // best effort
    }
    this.onClose(4998);
  }

  private onFrame(text: string): void {
    // Any frame is a sign of life, parsed or not (FR-SYNC-40).
    this.lastFrameAt = this.mono();
    this.pingSentAt = null;
    this.missedPongs = 0;
    let frame: ServerFrame;
    try {
      frame = ServerFrame.parse(JSON.parse(text));
    } catch {
      return;
    }
    switch (frame.type) {
      case "snapshot": {
        this.attempt = 0;
        this.epoch += 1;
        // Lazy types are in no snapshot, so replacing the store drops every lazy row (FR-SYNC-37).
        const store = applySnapshot(frame);
        this.set({
          state: "live",
          store,
          notLiveSince: null,
          everLive: true,
          scenes: sceneWindowAfterSnapshot(store),
          viewAs: viewAsAfterSnapshot(),
          lazy: lazyAfterSnapshot(this.snap.lazy.generation + 1),
        });
        return;
      }
      case "event": {
        const r = applyEvent(this.snap.store, frame);
        if (!r.ok) {
          this.ws?.send(JSON.stringify({ type: "resync" })); // seq gap (FR-SYNC-21)
          return;
        }
        this.set({ store: r.store });
        for (const fn of [...this.eventHandlers]) {
          try {
            fn(frame, r.store);
          } catch (err) {
            console.error(`event handler failed on ${frame.cause.name}`, err);
          }
        }
        return;
      }
      case "ack":
        this.pending.get(frame.intentId)?.resolve(frame.result);
        this.pending.delete(frame.intentId);
        return;
      case "reject":
        if (frame.intentId) {
          this.pending
            .get(frame.intentId)
            ?.reject(new IntentRejected(frame.code, frame.message, frame.issues));
          this.pending.delete(frame.intentId);
        }
        return;
      case "signal":
        for (const fn of [...this.signalHandlers]) {
          try {
            fn(frame);
          } catch (err) {
            console.error(`signal handler failed on ${frame.name}`, err);
          }
        }
        return;
      default:
        return;
    }
  }

  private onClose(code: number): void {
    this.clearTimers();
    this.ws = null;
    for (const p of this.pending.values()) {
      p.reject(new IntentRejected("disconnected", "Connection lost"));
    }
    this.pending.clear();
    if (this.stopped) return;
    const notLiveSince = this.snap.notLiveSince ?? this.clock.now();

    if (code === CloseCode.credentialInvalid) {
      this.set({ state: "rejected", notLiveSince });
      return; // FR-SYNC-05: stop only on 4401
    }
    if (code === CloseCode.campaignInactive) {
      if (this.opts.credential.role === "dm" && this.attempt === 0) {
        // FR-SYNC-07: DM reconnects at once into the new active campaign.
        this.attempt = 1;
        this.set({ state: "reconnecting", notLiveSince });
        this.retryTimer = this.clock.setTimeout(() => {
          this.retryTimer = null;
          this.open(); // server answered: no probe
        }, 0);
        return;
      }
      this.set({
        state: this.opts.credential.role === "dm" ? "reconnecting" : "waiting",
        notLiveSince,
      });
    } else {
      this.set({ state: this.snap.everLive ? "reconnecting" : "connecting", notLiveSince });
    }
    this.scheduleRetry();
  }

  /** Backoff wait (FR-SYNC-05), then `reconnect`. */
  private scheduleRetry(): void {
    const delay = backoffDelay(this.attempt);
    this.attempt += 1;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      this.reconnect();
    }, delay);
  }

  /**
   * Open a WebSocket, but after a failed attempt only once the HTTP probe says the endpoint
   * answers; an unreachable probe waits for the next backoff step without touching WebSocket,
   * so the browser's WS failure throttle never builds up during an outage (see `httpProbe`).
   */
  private reconnect(): void {
    if (this.stopped || this.ws !== null || this.probing) return;
    if (this.failedOpens === 0) {
      this.open();
      return;
    }
    const gen = ++this.generation;
    this.probing = true;
    const done = (ok: boolean) => {
      if (gen !== this.generation || this.stopped) return;
      this.probing = false;
      if (ok) this.open();
      else this.scheduleRetry();
    };
    let r: Promise<boolean> | boolean;
    try {
      r = (this.opts.probe ?? httpProbe)(this.opts.url ?? defaultWsUrl());
    } catch {
      r = false;
    }
    if (typeof r === "boolean") done(r);
    else r.then(done, () => done(false));
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) this.clock.clearInterval(this.pingTimer);
    if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
  }
}
