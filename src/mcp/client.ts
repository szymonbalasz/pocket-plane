// The MCP server's caller (AGENT §6 core, ADR-0072 D2–D4): the DM's existing REST routes and WS
// intents with the DM secret, one WS per call, nothing kept between calls but the auth latch.
import { CampaignRecord } from "@shared/campaign-management/schemas";
import { CloseCode } from "@shared/protocol/codes";
import { ServerFrame, type SnapshotFrame, WS_PATH } from "@shared/protocol/frames";
import { LoadResult, SYNC_LOAD } from "@shared/protocol/lazy";
import { z } from "zod";
import {
  AgentError,
  authRejected,
  noActiveCampaign,
  notRunning,
  rejectError,
  restError,
  stopped,
  throttled,
} from "./errors";
import { findServer, type LockReader } from "./lock";

/** FR-AGENT-14: every route / intent a tool may reach (spec §9); none deletes. */
export const ALLOWED_ROUTES = [
  "POST /api/dm/login",
  "GET /api/campaigns",
  "GET /api/compendium/search",
  "GET /api/compendium/entries/:id",
  "POST /api/entities",
  "PUT /api/entities/:id",
  "POST /api/compendium/derive-monster",
  "POST /api/compendium/entries",
  "PUT /api/compendium/entries/:id",
] as const;
export type AllowedRoute = (typeof ALLOWED_ROUTES)[number];
export const ALLOWED_INTENTS = [SYNC_LOAD, "char.putRow", "char.edit"] as const;
export type AllowedIntent = (typeof ALLOWED_INTENTS)[number];

/** FR-AGENT-06: no answer within this → `server_stopped`. */
export const CALL_TIMEOUT_MS = 10_000;

/** stderr only (FR-AGENT-02). */
export interface Log {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface CallerOptions {
  dataDir: string;
  profile: string;
  /** Never logged, returned or quoted (FR-AGENT-03). */
  dmSecret: string;
  log: Log;
  timeoutMs?: number;
  lock?: LockReader;
  /** Tests: each request as `"<METHOD> <route>"`, `"ws"` or `"intent <name>"`, before it is sent. */
  trace?: (reach: string) => void;
}

export interface RestRequest {
  id?: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Picks the `server_stopped` wording (FR-AGENT-06). */
  write?: boolean;
}

export interface WsSession {
  snapshot: SnapshotFrame;
  /** The snapshot's campaign: WS results name it (FR-AGENT-10). */
  campaign: { id: string; name: string };
  /** The snapshot's rows of `type`, each parsed with its `@shared` schema. */
  records<S extends z.ZodType>(type: string, schema: S): z.output<S>[];
  /** An allow-listed intent; resolves with the ack's `result`, throws on a reject. */
  intent(name: AllowedIntent, payload: unknown): Promise<unknown>;
  /** `sync.load {type, ids?}` (ADR-0045): the ack's rows of `type`, parsed. */
  load<S extends z.ZodType>(type: string, schema: S, ids?: string[]): Promise<z.output<S>[]>;
}

const isRefused = (err: unknown) => {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "ConnectionRefused" || code === "ECONNREFUSED";
};

function parseRows<S extends z.ZodType>(rows: unknown[], schema: S, what: string): z.output<S>[] {
  return rows.map((row) => {
    const r = schema.safeParse(row);
    if (!r.success) throw new AgentError("internal", `Unexpected ${what} record from the server.`);
    return r.data;
  });
}

export class Caller {
  /** FR-AGENT-08: set by a REST 401 (or a confirmed WS 4401); no DM check until restart. */
  private authLatched = false;
  private readonly timeoutMs: number;

  constructor(private readonly opts: CallerOptions) {
    this.timeoutMs = opts.timeoutMs ?? CALL_TIMEOUT_MS;
  }

  get profile() {
    return this.opts.profile;
  }

  private locate() {
    if (this.authLatched) throw authRejected();
    return findServer(this.opts.dataDir, this.opts.profile, this.opts.lock);
  }

  /** One REST request; its answer parsed with `schema` (204 → `undefined`). */
  async rest<S extends z.ZodType>(
    route: AllowedRoute,
    req: RestRequest,
    schema: S,
  ): Promise<z.output<S>> {
    const server = this.locate();
    return this.send(server.http, route, req, schema);
  }

  private async send<S extends z.ZodType>(
    http: string,
    route: AllowedRoute,
    req: RestRequest,
    schema: S,
  ): Promise<z.output<S>> {
    if (!(ALLOWED_ROUTES as readonly string[]).includes(route)) {
      throw new AgentError("internal", `Route not allowed: ${route}`);
    }
    const [method, pattern] = route.split(" ") as [string, string];
    let path = pattern;
    if (path.includes(":id")) {
      if (req.id === undefined) throw new AgentError("internal", `${route} needs an id`);
      path = path.replace(":id", encodeURIComponent(req.id));
    }
    const qs = req.query ? new URLSearchParams(req.query).toString() : "";
    const write = req.write ?? false;
    this.opts.trace?.(route);
    let res: Response;
    let text: string;
    try {
      res = await fetch(`${http}${path}${qs ? `?${qs}` : ""}`, {
        method,
        headers: {
          authorization: `Bearer ${this.opts.dmSecret}`,
          ...(req.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await res.text();
    } catch (err) {
      // FR-AGENT-05/06: refused before anything was sent = not running; anything else = stopped.
      if (isRefused(err)) throw notRunning(this.opts.profile);
      throw stopped(write);
    }
    let json: unknown;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (res.status === 401) {
      this.authLatched = true;
      throw authRejected();
    }
    if (!res.ok) throw restError(res.status, json, route);
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new AgentError("internal", `Unexpected answer from ${route}.`);
    return parsed.data;
  }

  /** One WS for one call (FR-AGENT-09): hello → snapshot → `run` → close 1000. */
  async ws<T>(opts: { write?: boolean }, run: (s: WsSession) => Promise<T>): Promise<T> {
    const server = this.locate();
    const write = opts.write ?? false;
    this.opts.trace?.("ws");
    const conn = new WsConn(`${server.ws}${WS_PATH}`, this.timeoutMs);
    try {
      const open = await conn.opened();
      if (open === "refused") throw notRunning(this.opts.profile);
      if (open === "timeout") throw stopped(write);
      conn.send({ type: "hello", credential: { role: "dm", secret: this.opts.dmSecret } });
      const snap = await conn.wait((f) => f.type === "snapshot");
      if (!snap.ok) throw await this.wsFailure(snap, server.http, write);
      const snapshot = snap.frame as SnapshotFrame;
      const campaign = parseRows(snapshot.records.campaign ?? [], CampaignRecord, "campaign").find(
        (c) => c.id === snapshot.you.campaignId,
      );
      let n = 0;
      const intent = async (name: AllowedIntent, payload: unknown) => {
        if (!(ALLOWED_INTENTS as readonly string[]).includes(name)) {
          throw new AgentError("internal", `Intent not allowed: ${name}`);
        }
        const intentId = `mcp-${++n}`;
        this.opts.trace?.(`intent ${name}`);
        conn.send({ type: "intent", intentId, name, payload });
        const r = await conn.wait(
          (f) => (f.type === "ack" || f.type === "reject") && f.intentId === intentId,
        );
        if (!r.ok) throw await this.wsFailure(r, server.http, write);
        if (r.frame.type === "reject") throw rejectError(r.frame, name);
        return r.frame.type === "ack" ? r.frame.result : undefined;
      };
      const session: WsSession = {
        snapshot,
        campaign: { id: snapshot.you.campaignId, name: campaign?.name ?? "" },
        records: (type, schema) => parseRows(snapshot.records[type] ?? [], schema, type),
        intent,
        async load(type, schema, ids) {
          const result = LoadResult.safeParse(
            await intent(SYNC_LOAD, ids === undefined ? { type } : { type, ids }),
          );
          if (!result.success) throw new AgentError("internal", "Unexpected sync.load answer.");
          return parseRows(result.data.records[type] ?? [], schema, type);
        },
      };
      return await run(session);
    } finally {
      conn.close();
    }
  }

  /** A WS that closed or went quiet mid-call → the §11 code. */
  private async wsFailure(f: WaitFailure, http: string, write: boolean): Promise<AgentError> {
    if (f.reason === "timeout") return stopped(write);
    if (f.code === CloseCode.campaignInactive) return noActiveCampaign();
    if (f.code !== CloseCode.credentialInvalid) return stopped(write);
    // FR-AGENT-08: 4401 is a wrong secret *or* the server-wide throttle; the login probe tells.
    try {
      await this.send(http, "POST /api/dm/login", { write }, z.unknown());
      return throttled();
    } catch (err) {
      if (err instanceof AgentError && (err.code === "auth" || err.code === "throttled")) {
        return err;
      }
      return stopped(write);
    }
  }
}

type WaitFailure = { ok: false; reason: "closed"; code: number } | { ok: false; reason: "timeout" };
type WaitResult = { ok: true; frame: ServerFrame } | WaitFailure;

/** A minimal frame queue over Bun's WebSocket (ADR-0072 D5: not the browser client). */
class WsConn {
  private readonly ws: WebSocket;
  private readonly frames: ServerFrame[] = [];
  private closedCode: number | null = null;
  private wasOpen = false;
  private wake: (() => void) | null = null;
  private readonly openP: Promise<"open" | "refused">;

  constructor(
    url: string,
    private readonly timeoutMs: number,
  ) {
    this.ws = new WebSocket(url);
    this.openP = new Promise((resolve) => {
      this.ws.addEventListener("open", () => {
        this.wasOpen = true;
        resolve("open");
      });
      this.ws.addEventListener("close", (e) => {
        this.closedCode = e.code;
        resolve(this.wasOpen ? "open" : "refused");
        this.wake?.();
      });
    });
    this.ws.addEventListener("message", (e) => {
      try {
        const f = ServerFrame.safeParse(JSON.parse(String(e.data)));
        if (f.success) this.frames.push(f.data);
      } catch {
        // Not JSON: not a frame this client knows; ignored like an unknown frame type.
      }
      this.wake?.();
    });
  }

  /** `refused`: closed before it opened (FR-AGENT-05); `timeout`: no answer (FR-AGENT-06). */
  opened(): Promise<"open" | "refused" | "timeout"> {
    return Promise.race([this.openP, Bun.sleep(this.timeoutMs).then(() => "timeout" as const)]);
  }

  send(frame: unknown) {
    this.ws.send(JSON.stringify(frame));
  }

  /** The next frame matching `pred` (others are skipped), or why none came. */
  async wait(pred: (f: ServerFrame) => boolean): Promise<WaitResult> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      while (this.frames.length > 0) {
        const f = this.frames.shift() as ServerFrame;
        if (pred(f)) return { ok: true, frame: f };
      }
      if (this.closedCode !== null) return { ok: false, reason: "closed", code: this.closedCode };
      const left = deadline - Date.now();
      if (left <= 0) return { ok: false, reason: "timeout" };
      await new Promise<void>((r) => {
        this.wake = r;
        setTimeout(r, Math.min(left, 100));
      });
      this.wake = null;
    }
  }

  close() {
    if (this.closedCode === null) this.ws.close(1000);
  }
}
