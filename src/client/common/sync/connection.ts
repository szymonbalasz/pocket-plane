// Client side of live-sync: hello, heartbeat, auto-reconnect, store, intents (SYNC §6, §7).
// No feature logic: features read records from the store and send intents.
import { CloseCode } from "@shared/protocol/codes";
import {
  CLIENT_PONG_TIMEOUT_MS,
  type Credential,
  PING_INTERVAL_MS,
  ServerFrame,
  type ServerSignalFrame,
  WS_PATH,
} from "@shared/protocol/frames";
import { applyEvent, applySnapshot, emptyStore, type RecordStore } from "@shared/protocol/store";
import { backoffDelay } from "./backoff";

export type ConnState = "connecting" | "live" | "reconnecting" | "waiting" | "rejected";

/** Incoming signal; `from` is server-stamped (ADR-0026). Receivers filter by scene themselves. */
export type SignalHandler = (s: ServerSignalFrame) => void;

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
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}

const browserClock: Clock = {
  now: () => Date.now(),
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
}

const PROBE_TIMEOUT_MS = 2_000;

/**
 * Reachability probe: a plain HTTP GET of the WS path. The server answers a non-upgrade request
 * with 426 (protocol §6); a dead server gives a network error, and the dev proxy gives a 5xx.
 * Why: Chromium throttles new WebSockets per renderer by recent *WebSocket* failures
 * (`services/network/websocket_throttler.cc`: up to +5 s per connect after ~16 failures/success).
 * Probing with fetch during an outage keeps WS failures at one per outage (FR-SYNC-05).
 */
export async function httpProbe(wsUrl: string): Promise<boolean> {
  try {
    const r = await fetch(wsUrl.replace(/^ws/, "http"), {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return r.status === 426;
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

export function defaultWsUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}${WS_PATH}`;
}

export class SyncConnection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: unknown = null;
  private pingTimer: unknown = null;
  private lastPongAt = 0;
  private stopped = false;
  /** WS attempts since the last open that never reached `onopen`; > 0 → probe before the next. */
  private failedOpens = 0;
  /** Bumped on stop and on every new attempt; a stale probe result is ignored. */
  private generation = 0;
  private probing = false;
  private pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>();
  private signalHandlers = new Set<SignalHandler>();
  private snap: SyncSnapshot = {
    state: "connecting",
    store: emptyStore(),
    notLiveSince: null,
    everLive: false,
  };
  private readonly clock: Clock;
  private wakeOff: (() => void) | null = null;

  constructor(private readonly opts: ConnectionOptions) {
    this.clock = opts.clock ?? browserClock;
  }

  get snapshot(): SyncSnapshot {
    return this.snap;
  }

  start(): void {
    this.stopped = false;
    this.wakeOff = (this.opts.onWake ?? browserWake)(() => this.retryNow());
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.probing = false;
    this.wakeOff?.();
    this.wakeOff = null;
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

  private set(patch: Partial<SyncSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.opts.onChange(this.snap);
  }

  private open(): void {
    if (this.stopped) return;
    const url = this.opts.url ?? defaultWsUrl();
    const ws = this.opts.createSocket ? this.opts.createSocket(url) : new WebSocket(url);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.failedOpens = 0;
      ws.send(JSON.stringify({ type: "hello", credential: this.opts.credential }));
      this.lastPongAt = this.clock.now();
      this.pingTimer = this.clock.setInterval(() => this.heartbeat(), PING_INTERVAL_MS);
    };
    ws.onmessage = (e) => this.onFrame(String(e.data));
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      if (!opened) this.failedOpens += 1;
      this.onClose(e.code);
    };
  }

  private heartbeat(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (this.clock.now() - this.lastPongAt > CLIENT_PONG_TIMEOUT_MS) {
      ws.close(4998, "pong timeout"); // FR-SYNC-04: treat as dropped
      return;
    }
    ws.send(JSON.stringify({ type: "ping" }));
  }

  private onFrame(text: string): void {
    let frame: ServerFrame;
    try {
      frame = ServerFrame.parse(JSON.parse(text));
    } catch {
      return;
    }
    this.lastPongAt = this.clock.now();
    switch (frame.type) {
      case "snapshot":
        this.attempt = 0;
        this.set({
          state: "live",
          store: applySnapshot(frame),
          notLiveSince: null,
          everLive: true,
        });
        return;
      case "event": {
        const r = applyEvent(this.snap.store, frame);
        if (r.ok) this.set({ store: r.store });
        else this.ws?.send(JSON.stringify({ type: "resync" })); // seq gap (FR-SYNC-21)
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
