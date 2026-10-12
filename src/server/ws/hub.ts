// WS hub + broadcaster + presence (live-sync §6, §9; docs/protocol §3). Holds no play state.
import { PRESENCE_CAUSE } from "@shared/events";
import { CloseCode, CloseReason } from "@shared/protocol/codes";
import {
  ClientFrame,
  type EventFrame,
  HELLO_TIMEOUT_MS,
  MAX_CLIENT_FRAME_BYTES,
  type RejectFrame,
  SERVER_SILENCE_MS,
  type ServerFrame,
  type SnapshotFrame,
} from "@shared/protocol/frames";
import { CommandError } from "../commands/errors";
import type { DispatchedEvent, RecordChange, Role } from "../events/types";
import type { Services } from "../services";
import type { Viewer, WireChange } from "./records";
import { realTimers, type TimerHandle, type Timers } from "./timers";

export interface SocketLike {
  /** Bun semantics: bytes sent, -1 = queued under backpressure, 0 = dropped. */
  send(data: string): number;
  close(code?: number, reason?: string): void;
  getBufferedAmount(): number;
}

export type Phase = "awaiting-hello" | "snapshotting" | "live" | "closed";

export interface Connection {
  readonly connId: string;
  phase: Phase;
  campaignId: string | null;
  role: Role | null;
  playerId: string | null;
  seq: number;
  lastInboundAt: number;
  /** Domain events dispatched while snapshotting; delivered after the snapshot (FR-SYNC-10). */
  pending: (() => void)[];
  socket: SocketLike;
  helloTimer: TimerHandle | null;
  /** Counted in presence (live player connection). */
  presenceCounted: boolean;
}

export type ConnSelector = (c: Readonly<Connection>) => boolean;

export interface HubOptions {
  timers?: Timers;
  /** Test-only: pause a snapshot between read and send (FR-SYNC-26). */
  beforeSnapshotSend?: (c: Readonly<Connection>) => Promise<void> | void;
  /** Send-buffer limit before closing 4000 (FR-SYNC-21). */
  maxBufferedBytes?: number;
  heartbeatCheckMs?: number;
}

export interface HubApi {
  resync(selector: ConnSelector): void;
  disconnect(selector: ConnSelector, code: number): void;
  connections(campaignId: string): Readonly<Connection>[];
}

export class Hub implements HubApi {
  private conns = new Map<string, Connection>();
  /** campaignId → playerId → live connection count. */
  private online = new Map<string, Map<string, number>>();
  private nextConn = 1;
  private readonly timers: Timers;
  private readonly heartbeat: TimerHandle;
  private readonly maxBuffered: number;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly s: Services,
    private readonly opts: HubOptions = {},
  ) {
    this.timers = opts.timers ?? realTimers;
    this.maxBuffered = opts.maxBufferedBytes ?? 1024 * 1024;
    this.heartbeat = this.timers.setInterval(
      () => this.checkSilence(),
      opts.heartbeatCheckMs ?? 1_000,
    );
    this.unsubscribe = s.bus.subscribe("broadcaster", (e) => this.broadcast(e));
  }

  // ---------- transport callbacks ----------

  open(socket: SocketLike): Connection {
    const c: Connection = {
      connId: `c${this.nextConn++}`,
      phase: "awaiting-hello",
      campaignId: null,
      role: null,
      playerId: null,
      seq: 0,
      lastInboundAt: this.s.clock.now(),
      pending: [],
      socket,
      helloTimer: null,
      presenceCounted: false,
    };
    c.helloTimer = this.timers.setTimeout(() => {
      if (c.phase === "awaiting-hello") this.close(c, CloseCode.noHello);
    }, HELLO_TIMEOUT_MS);
    this.conns.set(c.connId, c);
    return c;
  }

  message(c: Connection, raw: string | Uint8Array): undefined {
    if (c.phase === "closed") return;
    const bytes = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
    if (bytes > MAX_CLIENT_FRAME_BYTES) return this.close(c, CloseCode.frameTooLarge);
    c.lastInboundAt = this.s.clock.now();
    const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      if (c.phase === "awaiting-hello") return this.close(c, CloseCode.noHello);
      return this.reject(c, null, "invalid", "Invalid JSON");
    }
    const parsed = ClientFrame.safeParse(json);
    if (c.phase === "awaiting-hello") {
      if (!parsed.success || parsed.data.type !== "hello") {
        const isHello = (json as { type?: unknown } | null)?.type === "hello";
        return this.close(c, isHello ? CloseCode.credentialInvalid : CloseCode.noHello);
      }
      return this.hello(c, parsed.data.credential);
    }
    if (!parsed.success) {
      const intentId = (json as { intentId?: unknown } | null)?.intentId;
      return this.reject(
        c,
        typeof intentId === "string" && intentId.length <= 64 ? intentId : null,
        "invalid",
        "Invalid frame",
        parsed.error.issues.map((i) => ({
          path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
          message: i.message,
        })),
      );
    }
    const f = parsed.data;
    switch (f.type) {
      case "hello":
        return this.reject(c, null, "invalid", "Already authenticated");
      case "ping":
        this.send(c, { type: "pong" });
        return;
      case "resync":
        if (c.phase === "live") void this.sendSnapshot(c);
        return;
      case "signal":
        // No signal types in Foundation (docs/protocol §7).
        return this.reject(c, null, "unknown_intent", `Unknown signal "${f.name}"`);
      case "intent":
        return this.intent(c, f.intentId, f.name, f.payload);
    }
  }

  closed(c: Connection): undefined {
    this.drop(c);
  }

  // ---------- hub API (SYNC §9) ----------

  resync(selector: ConnSelector): undefined {
    for (const c of this.conns.values()) {
      if (c.phase === "live" && selector(c)) void this.sendSnapshot(c);
    }
  }

  disconnect(selector: ConnSelector, code: number): undefined {
    for (const c of [...this.conns.values()]) {
      if (c.phase !== "closed" && selector(c)) this.close(c, code);
    }
  }

  connections(campaignId: string): Readonly<Connection>[] {
    return [...this.conns.values()].filter(
      (c) => c.campaignId === campaignId && c.phase !== "closed",
    );
  }

  /** Clean shutdown: close everything with 1001 (client reconnects with backoff). */
  shutdown(): undefined {
    this.disconnect(() => true, CloseCode.shutdown);
    this.timers.clearInterval(this.heartbeat);
    this.unsubscribe();
  }

  isOnline(campaignId: string, playerId: string): boolean {
    return (this.online.get(campaignId)?.get(playerId) ?? 0) > 0;
  }

  // ---------- internals ----------

  private hello(
    c: Connection,
    cred: { role: "dm"; secret: string } | { role: "player"; token: string },
  ): undefined {
    if (c.helloTimer !== null) this.timers.clearTimeout(c.helloTimer);
    c.helloTimer = null;
    if (cred.role === "dm") {
      const r = this.s.auth.verifyDmCredential(cred.secret);
      if (r === "invalid" || r === "throttled") return this.close(c, CloseCode.credentialInvalid);
      if (r === "noActiveCampaign") return this.close(c, CloseCode.campaignInactive);
      c.role = "dm";
      c.campaignId = r.campaignId;
    } else {
      const r = this.s.auth.resolvePlayerLink(cred.token);
      if (!r) return this.close(c, CloseCode.credentialInvalid);
      if (!r.campaignActive) return this.close(c, CloseCode.campaignInactive);
      c.role = "player";
      c.campaignId = r.campaignId;
      c.playerId = r.playerId;
    }
    void this.sendSnapshot(c);
  }

  private viewer(c: Connection): Viewer {
    return {
      connId: c.connId,
      campaignId: c.campaignId ?? "",
      role: c.role ?? "player",
      playerId: c.playerId,
    };
  }

  private async sendSnapshot(c: Connection): Promise<void> {
    c.phase = "snapshotting";
    c.pending = [];
    let frame: SnapshotFrame;
    try {
      const v = this.viewer(c);
      frame = {
        type: "snapshot",
        seq: 0,
        you: { campaignId: v.campaignId, role: v.role, playerId: v.playerId },
        records: this.s.records.snapshot({ db: this.s.db, presence: this.presenceView() }, v),
      };
    } catch (err) {
      this.s.log.error(`snapshot failed for ${c.connId}`, err);
      return this.close(c, CloseCode.resyncRequired);
    }
    if (this.opts.beforeSnapshotSend) await this.opts.beforeSnapshotSend(c);
    if (c.phase !== "snapshotting") return; // closed meanwhile
    c.seq = 0;
    if (!this.send(c, frame)) return;
    c.phase = "live";
    if (!c.presenceCounted && c.role === "player" && c.playerId && c.campaignId) {
      c.presenceCounted = true;
      this.presenceDelta(c.campaignId, c.playerId, +1);
    }
    const queued = c.pending;
    c.pending = [];
    for (const deliver of queued) {
      if (c.phase !== "live") break;
      deliver();
    }
  }

  private intent(c: Connection, intentId: string, name: string, payload: unknown): undefined {
    if (c.phase !== "live" || !c.role) {
      return this.reject(c, intentId, "invalid", "Connection not live");
    }
    if (!this.s.intents.has(name)) {
      return this.reject(c, intentId, "unknown_intent", `Unknown intent "${name}"`);
    }
    let result: unknown;
    try {
      result = this.s.commands.run(name, payload, {
        actor: { role: c.role, playerId: c.playerId, campaignId: c.campaignId },
        intentId,
        originConnId: c.connId,
      });
    } catch (err) {
      if (err instanceof CommandError) {
        return this.reject(c, intentId, err.code, err.message, err.issues);
      }
      this.s.log.error(`intent ${name} failed`, err);
      return this.reject(c, intentId, "internal", "Internal error");
    }
    // A listener (e.g. campaign switch) may have closed this connection.
    if ((c.phase as Phase) === "closed") return;
    this.send(
      c,
      result === undefined ? { type: "ack", intentId } : { type: "ack", intentId, result },
    );
  }

  /** Bus listener: one `event` frame per connection per domain event (FR-SYNC-17). */
  private broadcast(e: DispatchedEvent): undefined {
    const { event, meta } = e;
    if (event.changes.length === 0) return;
    for (const c of this.conns.values()) {
      if (c.campaignId === null) continue;
      const deliver = () => {
        const intentId = c.connId === meta.originConnId ? (meta.intentId ?? undefined) : undefined;
        this.deliver(c, event.changes, { name: event.type, intentId });
      };
      if (c.phase === "snapshotting") c.pending.push(deliver);
      else if (c.phase === "live") deliver();
    }
  }

  private deliver(c: Connection, changes: RecordChange[], cause: EventFrame["cause"]): undefined {
    let out: WireChange[];
    try {
      const v = this.viewer(c);
      out = [];
      for (const ch of changes) {
        const w = this.s.records.filterChange(ch, v);
        if (w) out.push(w);
      }
    } catch (err) {
      this.s.log.error(`broadcaster failed for ${c.connId}`, err);
      return this.close(c, CloseCode.resyncRequired);
    }
    if (out.length === 0) return;
    c.seq += 1;
    const frame: EventFrame = { type: "event", seq: c.seq, cause, changes: out };
    if (cause.intentId === undefined) delete frame.cause.intentId;
    this.send(c, frame);
  }

  private presenceView() {
    return {
      list: (campaignId: string) =>
        [...(this.online.get(campaignId) ?? new Map<string, number>()).entries()].map(
          ([playerId, n]) => ({ playerId, online: n > 0 }),
        ),
    };
  }

  private presenceDelta(campaignId: string, playerId: string, delta: 1 | -1): undefined {
    let m = this.online.get(campaignId);
    if (!m) {
      m = new Map();
      this.online.set(campaignId, m);
    }
    const before = m.get(playerId) ?? 0;
    const after = Math.max(0, before + delta);
    if (after === 0) m.delete(playerId);
    else m.set(playerId, after);
    if (before > 0 === after > 0) return;
    const rec = (online: boolean) => ({ id: playerId, playerId, campaignId, online });
    const change: RecordChange = {
      type: "presence",
      id: playerId,
      before: rec(before > 0),
      after: rec(after > 0),
    };
    // Presence is not a domain event: no bus, no log (CON-07).
    for (const c of this.conns.values()) {
      if (c.campaignId !== campaignId) continue;
      const deliver = () => this.deliver(c, [change], { name: PRESENCE_CAUSE });
      if (c.phase === "snapshotting") c.pending.push(deliver);
      else if (c.phase === "live") deliver();
    }
  }

  private reject(
    c: Connection,
    intentId: string | null,
    code: RejectFrame["code"],
    message: string,
    issues?: RejectFrame["issues"],
  ): undefined {
    const f: RejectFrame = { type: "reject", intentId, code, message };
    if (issues) f.issues = issues;
    this.send(c, f);
  }

  /** Never drops frames: a dropped or overflowing send closes 4000 (FR-SYNC-21). */
  private send(c: Connection, frame: ServerFrame): boolean {
    if (c.phase === "closed") return false;
    let r: number;
    try {
      r = c.socket.send(JSON.stringify(frame));
    } catch (err) {
      this.s.log.warn(`send failed on ${c.connId}`, err);
      this.close(c, CloseCode.resyncRequired);
      return false;
    }
    if (r === 0 || c.socket.getBufferedAmount() > this.maxBuffered) {
      this.close(c, CloseCode.resyncRequired);
      return false;
    }
    return true;
  }

  private checkSilence(): undefined {
    const now = this.s.clock.now();
    for (const c of [...this.conns.values()]) {
      if (c.phase !== "closed" && now - c.lastInboundAt >= SERVER_SILENCE_MS) {
        this.close(c, CloseCode.noHello); // heartbeat timeout uses 4408 (CON-11)
      }
    }
  }

  private close(c: Connection, code: number): undefined {
    if (c.phase === "closed") return;
    const reason = CloseReason[code as keyof typeof CloseReason] ?? "";
    this.drop(c);
    try {
      c.socket.close(code, reason);
    } catch {
      // already closed by the peer
    }
  }

  private drop(c: Connection): undefined {
    if (c.phase === "closed" && !this.conns.has(c.connId)) return;
    c.phase = "closed";
    c.pending = [];
    if (c.helloTimer !== null) this.timers.clearTimeout(c.helloTimer);
    c.helloTimer = null;
    this.conns.delete(c.connId);
    if (c.presenceCounted && c.playerId && c.campaignId) {
      c.presenceCounted = false;
      this.presenceDelta(c.campaignId, c.playerId, -1);
    }
  }
}
