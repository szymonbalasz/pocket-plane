// Multi-client test harness (live-sync §13): in-process server on port 0, real sockets,
// the real store reducer, frame log, fake clock + timers, pauseSnapshot, restart on the same DB.
import { CloseCode } from "@shared/protocol/codes";
import type { Credential, ServerFrame } from "@shared/protocol/frames";
import { applyEvent, applySnapshot, emptyStore, type RecordStore } from "@shared/protocol/store";
import { manualClock } from "../commands/context";
import type { Db } from "../db/client";
import { openTestDb } from "../db/testing";
import { silentLogger } from "../log";
import { type RunningServer, startServer } from "../server";
import type { Connection } from "../ws/hub";
import { fakeTimers } from "../ws/timers";
import { createTestServices, TEST_SECRET } from "./services";

export interface TestClient {
  frames: ServerFrame[];
  store: RecordStore;
  /** True once a seq gap was seen. */
  gap: boolean;
  closed: Promise<{ code: number; reason: string }>;
  isClosed(): boolean;
  send(frame: unknown): void;
  sendRaw(text: string): void;
  intent(name: string, payload: unknown, intentId?: string): string;
  /** Next unread frame (optionally of a type), waiting up to `ms`. */
  next<T extends ServerFrame["type"]>(
    type?: T,
    ms?: number,
  ): Promise<Extract<ServerFrame, { type: T }>>;
  expectNoFrame(ms?: number): Promise<void>;
  close(): void;
  /** Every byte received, for leak scans. */
  raw(): string;
}

export async function connectClient(
  url: string,
  credential: Credential | null,
): Promise<TestClient> {
  const ws = new WebSocket(url);
  const frames: ServerFrame[] = [];
  const rawLog: string[] = [];
  let cursor = 0;
  let wake: (() => void) | null = null;
  let isClosed = false;
  const client: TestClient = {
    frames,
    store: emptyStore(),
    gap: false,
    closed: new Promise((resolve) => {
      ws.addEventListener("close", (e) => {
        isClosed = true;
        resolve({ code: e.code, reason: e.reason });
        wake?.();
      });
    }),
    isClosed: () => isClosed,
    send: (f) => ws.send(JSON.stringify(f)),
    sendRaw: (t) => ws.send(t),
    intent(name, payload, intentId = crypto.randomUUID()) {
      ws.send(JSON.stringify({ type: "intent", intentId, name, payload }));
      return intentId;
    },
    async next(type, ms = 2000) {
      const deadline = Date.now() + ms;
      for (;;) {
        while (cursor < frames.length) {
          const f = frames[cursor++] as ServerFrame;
          if (!type || f.type === type) return f as never;
        }
        const left = deadline - Date.now();
        if (left <= 0 || isClosed) {
          throw new Error(`No ${type ?? "frame"} within ${ms} ms (closed: ${isClosed})`);
        }
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, Math.min(left, 50));
        });
      }
    },
    async expectNoFrame(ms = 150) {
      const before = frames.length;
      await Bun.sleep(ms);
      if (frames.length > before) {
        throw new Error(`Unexpected frame: ${JSON.stringify(frames[before])}`);
      }
    },
    close: () => ws.close(),
    raw: () => rawLog.join("\n"),
  };
  ws.addEventListener("message", (e) => {
    const text = String(e.data);
    rawLog.push(text);
    const f = JSON.parse(text) as ServerFrame;
    frames.push(f);
    if (f.type === "snapshot") {
      client.store = applySnapshot(f);
      client.gap = false;
    } else if (f.type === "event") {
      const r = applyEvent(client.store, f);
      if (r.ok) client.store = r.store;
      else client.gap = true;
    }
    wake?.();
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("WS connect failed")), { once: true });
  });
  if (credential) ws.send(JSON.stringify({ type: "hello", credential }));
  return client;
}

export interface TestServerOptions {
  testMode?: boolean;
  db?: Db;
  fake?: boolean;
}

export async function startTestServer(opts: TestServerOptions = {}) {
  const clock = manualClock(Date.parse("2026-03-01T00:00:00Z"));
  const timers = fakeTimers(clock);
  const db = opts.db ?? openTestDb();
  let pause: { gate: Promise<void>; reached: () => void } | null = null;
  let reachedResolve: (() => void) | null = null;

  const config = createTestServices({ testMode: opts.testMode, db }).config;
  const boot = () =>
    startServer({
      config,
      log: silentLogger,
      db,
      lock: false,
      clock: opts.fake === false ? undefined : clock,
      hub: {
        timers: opts.fake === false ? undefined : timers,
        beforeSnapshotSend: async (_c: Readonly<Connection>) => {
          if (!pause) return;
          const p = pause;
          pause = null;
          p.reached();
          await p.gate;
        },
      },
    });
  let running: RunningServer = await boot();
  const clients: TestClient[] = [];

  const h = {
    get s() {
      return running.services;
    },
    get hub() {
      return running.hub;
    },
    get url() {
      return `ws://127.0.0.1:${running.port}/ws`;
    },
    get http() {
      return `http://127.0.0.1:${running.port}`;
    },
    db,
    clock,
    timers,
    async connect(credential: Credential | null) {
      const c = await connectClient(h.url, credential);
      clients.push(c);
      return c;
    },
    dm: () => h.connect({ role: "dm", secret: TEST_SECRET }),
    player: (token: string) => h.connect({ role: "player", token }),
    /** Connect and wait for the snapshot. */
    async live(credential: Credential) {
      const c = await h.connect(credential);
      await c.next("snapshot");
      return c;
    },
    /** Next snapshot pauses between read and send until `release()` (FR-SYNC-26). */
    pauseSnapshot() {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const reached = new Promise<void>((r) => {
        reachedResolve = r;
      });
      pause = { gate, reached: () => reachedResolve?.() };
      return { reached, release };
    },
    async restart() {
      await running.stop();
      running = await boot();
    },
    async stop() {
      for (const c of clients) c.close();
      await running.stop();
    },
  };
  return h;
}

export type TestServer = Awaited<ReturnType<typeof startTestServer>>;

export { CloseCode, TEST_SECRET };
