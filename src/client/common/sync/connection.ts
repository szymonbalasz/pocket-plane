// Client side of live-sync: hello, heartbeat, auto-reconnect, store, intents (SYNC §6, §7).
// No feature logic: features read records from the store and send intents.
import { CloseCode } from "@shared/protocol/codes";
import {
  CLIENT_PONG_TIMEOUT_MS,
  type Credential,
  PING_INTERVAL_MS,
  ServerFrame,
  WS_PATH,
} from "@shared/protocol/frames";
import { applyEvent, applySnapshot, emptyStore, type RecordStore } from "@shared/protocol/store";
import { backoffDelay } from "./backoff";

export type ConnState = "connecting" | "live" | "reconnecting" | "waiting" | "rejected";

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
  private pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>();
  private snap: SyncSnapshot = {
    state: "connecting",
    store: emptyStore(),
    notLiveSince: null,
    everLive: false,
  };
  private readonly clock: Clock;

  constructor(private readonly opts: ConnectionOptions) {
    this.clock = opts.clock ?? browserClock;
  }

  get snapshot(): SyncSnapshot {
    return this.snap;
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close(1000);
    this.ws = null;
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

  private set(patch: Partial<SyncSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.opts.onChange(this.snap);
  }

  private open(): void {
    if (this.stopped) return;
    const url = this.opts.url ?? defaultWsUrl();
    const ws = this.opts.createSocket ? this.opts.createSocket(url) : new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", credential: this.opts.credential }));
      this.lastPongAt = this.clock.now();
      this.pingTimer = this.clock.setInterval(() => this.heartbeat(), PING_INTERVAL_MS);
    };
    ws.onmessage = (e) => this.onFrame(String(e.data));
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
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
        this.retryTimer = this.clock.setTimeout(() => this.open(), 0);
        return;
      }
      this.set({
        state: this.opts.credential.role === "dm" ? "reconnecting" : "waiting",
        notLiveSince,
      });
    } else {
      this.set({ state: this.snap.everLive ? "reconnecting" : "connecting", notLiveSince });
    }
    const delay = backoffDelay(this.attempt);
    this.attempt += 1;
    this.retryTimer = this.clock.setTimeout(() => this.open(), delay);
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) this.clock.clearInterval(this.pingTimer);
    if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
  }
}
