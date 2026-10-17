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
  type ServerSignalFrame,
  type SignalFrom,
  type SnapshotFrame,
} from "@shared/protocol/frames";
import { LoadPayload, SYNC_LOAD } from "@shared/protocol/lazy";
import { LoadScenePayload, SYNC_LOAD_SCENE, VIEW_AS_PARTY } from "@shared/protocol/scene-window";
import { CommandError, zodIssues } from "../commands/errors";
import type { DispatchedEvent, RecordChange, Role } from "../events/types";
import type { Services } from "../services";
import type { PresenceView, Viewer, WireChange } from "./records";
import {
  type ResultSignal,
  reaches,
  resultSignals,
  type SignalAudience,
  type SignalRead,
  type SignalSender,
  validAudience,
} from "./signals";
import { realTimers, type TimerHandle, type Timers } from "./timers";

export interface SocketLike {
  /** Bun semantics: bytes sent, -1 = queued under backpressure, 0 = dropped. */
  send(data: string): number;
  close(code?: number, reason?: string): void;
  getBufferedAmount(): number;
}

/**
 * CON-44 snapshot ceilings (#142, raised for the DM by #208): DM 1 MiB, players 512 KiB. Not
 * enforced (a bigger snapshot is still sent); over → `warn` with per-type bytes (#163).
 */
export const SNAPSHOT_CEILING = { dm: 1024 * 1024, player: 512 * 1024 } as const;
/**
 * Send-buffer limit before closing 4000 (FR-SYNC-21) and Bun's `backpressureLimit` /
 * `maxPayloadLength` (#163): well above the largest allowed snapshot, so a slow tunnel never
 * turns a big snapshot into a 4000 → reconnect → same snapshot loop.
 */
export const SEND_BUFFER_LIMIT = 4 * 1024 * 1024;

/** Codes an `audience` hook may reject with (ADR-0033); anything else → `internal`. */
const SIGNAL_REJECT_CODES: ReadonlySet<RejectFrame["code"]> = new Set([
  "not_found",
  "forbidden",
  "invalid",
]);
/** Hook errors log at most once per (connection, signal name) per window (ADR-0033). */
export const SIGNAL_ERROR_LOG_MS = 10_000;

const utf8Bytes = (s: string) => Buffer.byteLength(s, "utf8");

/** Per-type bytes of a snapshot's `records`, largest first (the `"type":[…]` member). */
export function snapshotTypeBytes(records: Record<string, unknown[]>): [string, number][] {
  return Object.entries(records)
    .map(([t, rows]): [string, number] => [
      t,
      utf8Bytes(JSON.stringify(t)) + 1 + utf8Bytes(JSON.stringify(rows)),
    ])
    .sort((a, b) => b[1] - a[1]);
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
  /** Server signals sent here (OQ-FOG-58 rate): `name + key` → send times in the last second. */
  signalTimes?: Map<string, number[]>;
}

export type ConnSelector = (c: Readonly<Connection>) => boolean;

export interface HubOptions {
  timers?: Timers;
  /** Test-only: pause a snapshot between read and send (FR-SYNC-26). */
  beforeSnapshotSend?: (c: Readonly<Connection>) => Promise<void> | void;
  /** Send-buffer limit before closing 4000 (FR-SYNC-21). */
  maxBufferedBytes?: number;
  /** CON-44 ceilings for the size warning; tests lower them. */
  snapshotCeiling?: { dm: number; player: number };
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
  /** Read access for signal `audience` hooks (ADR-0033). */
  private readonly signalRead: SignalRead;
  /** connId → signal name → last logged hook error (ms). */
  private signalErrorAt = new Map<string, Map<string, number>>();

  constructor(
    private readonly s: Services,
    private readonly opts: HubOptions = {},
  ) {
    this.timers = opts.timers ?? realTimers;
    this.maxBuffered = opts.maxBufferedBytes ?? SEND_BUFFER_LIMIT;
    this.heartbeat = this.timers.setInterval(
      () => this.checkSilence(),
      opts.heartbeatCheckMs ?? 1_000,
    );
    this.unsubscribe = s.bus.subscribe("broadcaster", (e) => this.broadcast(e));
    this.signalRead = {
      db: s.db,
      activeSceneOf: (campaignId) => s.records.activeSceneOf(campaignId),
    };
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
        return this.signal(c, f.name, f.data);
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
    const text = JSON.stringify(frame);
    this.checkSnapshotSize(c, frame, utf8Bytes(text));
    if (!this.sendText(c, text)) return;
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
    if (name === SYNC_LOAD && c.role) return this.load(c, intentId, payload);
    if (c.phase !== "live" || !c.role) {
      return this.reject(c, intentId, "invalid", "Connection not live");
    }
    if (name === SYNC_LOAD_SCENE) return this.loadScene(c, intentId, payload);
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
    // OQ-FOG-58: signals the result carries go out right after the ack, in this frame order.
    for (const sig of resultSignals(result)) this.serverSignal(c, sig);
  }

  /**
   * A server-originated signal (OQ-FOG-58) from intent sender `c`: the registered schema, then
   * every other live connection of the campaign whose player is in the audience (never a DM),
   * each under the type's rate: an excess frame is dropped, never held.
   */
  private serverSignal(c: Connection, sig: ResultSignal): void {
    const def = this.s.signals.getServer(sig.name);
    const parsed = def?.schema.safeParse(sig.payload);
    if (!def || !parsed?.success) {
      this.s.log.error(`server signal ${sig.name} refused (unregistered or invalid payload)`);
      return;
    }
    const from: SignalFrom =
      c.role === "dm" ? { role: "dm" } : { role: "player", playerId: c.playerId ?? "" };
    const frame: ServerSignalFrame = { type: "signal", name: sig.name, data: parsed.data, from };
    const key = def.rate ? `${sig.name}|${def.rate.key(parsed.data)}` : null;
    const now = this.s.clock.now();
    for (const o of this.conns.values()) {
      if (o === c || o.phase !== "live" || o.campaignId !== c.campaignId) continue;
      if (o.role !== "player" || o.playerId === null) continue;
      if (!sig.audience.includes(o.playerId)) continue;
      if (def.rate && key !== null) {
        o.signalTimes ??= new Map();
        const recent = (o.signalTimes.get(key) ?? []).filter((t) => now - t < 1000);
        o.signalTimes.set(key, recent);
        if (recent.length >= def.rate.perSecond) continue;
        recent.push(now);
      }
      this.send(o, frame);
    }
  }

  /**
   * `sync.loadScene` (ADR-0041): DM only, read-only, no bus, log or `seq`. Answered here, in
   * this connection's frame order: every change committed before the read already went out as
   * an event, later ones follow as events (nothing lost or duplicated, as FR-SYNC-10).
   */
  private loadScene(c: Connection, intentId: string, payload: unknown): undefined {
    if (c.role !== "dm") return this.reject(c, intentId, "forbidden", "Not allowed");
    const parsed = LoadScenePayload.safeParse(payload);
    if (!parsed.success) {
      return this.reject(c, intentId, "invalid", "Invalid payload", zodIssues(parsed.error));
    }
    const { sceneId, viewAs } = parsed.data;
    let records: Record<string, unknown[]>;
    try {
      if (this.s.records.sceneCampaignOf(sceneId) !== c.campaignId) {
        return this.reject(c, intentId, "not_found", "Scene not found");
      }
      const src = { db: this.s.db, presence: this.presenceView() };
      if (viewAs === undefined) {
        records = this.s.records.loadScene(src, this.viewer(c), sceneId);
      } else {
        // FR-FOG-43: a player of the DM's campaign only (another campaign's looks unknown);
        // `"party"` (sprint 4): every player's rows.
        if (viewAs !== VIEW_AS_PARTY && this.s.records.playerCampaignOf(viewAs) !== c.campaignId) {
          return this.reject(c, intentId, "not_found", "Player not found");
        }
        records = this.s.records.loadViewAs(src, this.viewer(c), sceneId, viewAs);
      }
    } catch (err) {
      this.s.log.error(`${SYNC_LOAD_SCENE} failed for ${c.connId}`, err);
      return this.reject(c, intentId, "internal", "Internal error");
    }
    this.send(c, { type: "ack", intentId, result: { records } });
  }

  /**
   * `sync.load {type, ids?}` (ADR-0045, FR-SYNC-31–33): DM and player, read-only, no bus, DB
   * write, log or `seq`. Read at once and answered in this connection's frame order: changes
   * committed before the read already went out as events, later ones follow as events. While a
   * snapshot is between read and send (`resync`, FR-SYNC-26's pause), the answer queues behind
   * the events already pending, so nothing is lost or duplicated (as FR-SYNC-10).
   */
  private load(c: Connection, intentId: string, payload: unknown): undefined {
    const answer = (frame: ServerFrame): undefined => {
      if (c.phase === "snapshotting") c.pending.push(() => this.send(c, frame));
      else this.send(c, frame);
    };
    const reject = (
      code: RejectFrame["code"],
      message: string,
      issues?: RejectFrame["issues"],
    ): undefined => {
      const f: RejectFrame = { type: "reject", intentId, code, message };
      if (issues) f.issues = issues;
      return answer(f);
    };
    const parsed = LoadPayload.safeParse(payload);
    if (!parsed.success) return reject("invalid", "Invalid payload", zodIssues(parsed.error));
    const { type, ids } = parsed.data;
    const def = this.s.records.get(type);
    if (!def) return reject("invalid", `Unknown record type "${type}"`);
    if (def.lazy === undefined) return reject("invalid", `Record type "${type}" is not lazy`);
    if (def.lazy === "ids" && ids === undefined) {
      return reject("invalid", `Record type "${type}" loads by ids only`);
    }
    if (def.audience === "dm" && c.role !== "dm") return reject("forbidden", "Not allowed");
    let records: Record<string, unknown[]>;
    try {
      const src = { db: this.s.db, presence: this.presenceView() };
      records = this.s.records.load(src, this.viewer(c), type, ids);
    } catch (err) {
      this.s.log.error(`${SYNC_LOAD} ${type} failed for ${c.connId}`, err);
      return reject("internal", "Internal error");
    }
    return answer({ type: "ack", intentId, result: { records } });
  }

  /**
   * Signals (FR-SYNC-22, ADR-0026): zod + roles, then the type's `audience` hook (FR-SYNC-28,
   * ADR-0033), then forward to every **other** live connection of the sender's campaign (`"dm"`:
   * DM connections only) with a server-stamped `from`. No bus, DB write, log, snapshot or `seq`.
   */
  private signal(c: Connection, name: string, data: unknown): undefined {
    if (c.phase !== "live" || !c.role || !c.campaignId) {
      return this.reject(c, null, "invalid", "Connection not live");
    }
    const def = this.s.signals.get(name);
    if (!def) return this.reject(c, null, "unknown_intent", `Unknown signal "${name}"`);
    if (!def.roles.includes(c.role)) return this.reject(c, null, "forbidden", "Not allowed");
    const parsed = def.schema.safeParse(data);
    if (!parsed.success) {
      return this.reject(c, null, "invalid", "Invalid signal", zodIssues(parsed.error));
    }
    let audience: SignalAudience = "all";
    if (def.audience) {
      const sender: SignalSender = { role: c.role, campaignId: c.campaignId };
      if (c.playerId) sender.playerId = c.playerId;
      try {
        audience = def.audience(parsed.data, sender, this.signalRead);
        if (!validAudience(audience)) {
          throw new Error(`audience returned ${JSON.stringify(audience)}`);
        }
      } catch (err) {
        if (err instanceof CommandError && SIGNAL_REJECT_CODES.has(err.code)) {
          return this.reject(c, null, err.code, err.message, err.issues);
        }
        this.logSignalError(c, name, err);
        return this.reject(c, null, "internal", "Internal error");
      }
    }
    const from: SignalFrom =
      c.role === "dm" ? { role: "dm" } : { role: "player", playerId: c.playerId ?? "" };
    const frame: ServerSignalFrame = { type: "signal", name, data: parsed.data, from };
    for (const o of [...this.conns.values()]) {
      if (o === c || o.phase !== "live" || o.campaignId !== c.campaignId) continue;
      if (!reaches(audience, o)) continue;
      this.send(o, frame);
    }
  }

  /** Hook errors: logged at most once per (connection, signal name) per 10 s (ADR-0033). */
  private logSignalError(c: Connection, name: string, err: unknown): void {
    const now = this.s.clock.now();
    let byName = this.signalErrorAt.get(c.connId);
    if (!byName) {
      byName = new Map();
      this.signalErrorAt.set(c.connId, byName);
    }
    const last = byName.get(name);
    if (last !== undefined && now - last < SIGNAL_ERROR_LOG_MS) return;
    byName.set(name, now);
    this.s.log.error(`signal ${name} audience failed on ${c.connId}`, err);
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

  /**
   * FR-SYNC-17 / -19 (ADR-0042): nothing when no change passes the transition matrix; an event
   * whose surviving changes were all identical upserts (dropped per change) still goes out,
   * empty, so `seq` stays aligned with the events that touched this connection.
   */
  private deliver(c: Connection, changes: RecordChange[], cause: EventFrame["cause"]): undefined {
    let out: WireChange[];
    try {
      const r = this.s.records.filterChanges(changes, this.viewer(c));
      if (!r.touched) return;
      out = r.changes;
    } catch (err) {
      this.s.log.error(`broadcaster failed for ${c.connId}`, err);
      return this.close(c, CloseCode.resyncRequired);
    }
    c.seq += 1;
    const frame: EventFrame = { type: "event", seq: c.seq, cause, changes: out };
    if (cause.intentId === undefined) delete frame.cause.intentId;
    this.send(c, frame);
  }

  /** Live presence for snapshot providers (also read by the convergence test helpers). */
  presenceView(): PresenceView {
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

  /** CON-44 ceiling check (#163): over → warn with the largest types. Never blocks the send. */
  private checkSnapshotSize(c: Connection, frame: SnapshotFrame, bytes: number): void {
    const ceilings = this.opts.snapshotCeiling ?? SNAPSHOT_CEILING;
    const ceiling = c.role === "dm" ? ceilings.dm : ceilings.player;
    if (bytes <= ceiling) return;
    const types = snapshotTypeBytes(frame.records)
      .slice(0, 8)
      .map(([t, b]) => `${t} ${b} B`)
      .join(", ");
    this.s.log.warn(
      `snapshot for ${c.role} ${c.connId}: ${bytes} B over the ${ceiling} B ceiling (CON-44); largest: ${types}`,
    );
  }

  /** Never drops frames: a dropped or overflowing send closes 4000 (FR-SYNC-21). */
  private send(c: Connection, frame: ServerFrame): boolean {
    return this.sendText(c, JSON.stringify(frame));
  }

  private sendText(c: Connection, text: string): boolean {
    if (c.phase === "closed") return false;
    let r: number;
    try {
      r = c.socket.send(text);
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
    this.signalErrorAt.delete(c.connId);
    if (c.presenceCounted && c.playerId && c.campaignId) {
      c.presenceCounted = false;
      this.presenceDelta(c.campaignId, c.playerId, -1);
    }
  }
}
