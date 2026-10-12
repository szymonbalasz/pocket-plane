import { expect, test } from "bun:test";
import { type Clock, httpProbe, SyncConnection } from "./connection";

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close(code = 1000) {
    this.onclose?.({ code });
  }
}

function fakeClock() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  const clock: Clock & { advance(ms: number): void; pending(): number[] } = {
    now: () => now,
    setTimeout(fn, ms) {
      timers.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => void timers.delete(h as number),
    setInterval: () => 0,
    clearInterval() {},
    advance(ms) {
      now += ms;
      for (const [k, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(k);
          t.fn();
        }
      }
    },
    pending: () => [...timers.values()].map((t) => t.at - now),
  };
  return clock;
}

function setup(probe: () => Promise<boolean> | boolean = () => true) {
  const sockets: FakeSocket[] = [];
  let wake: (() => void) | null = null;
  const clock = fakeClock();
  const conn = new SyncConnection({
    probe,
    credential: { role: "player", token: "t" },
    url: "ws://x/ws",
    clock,
    onChange() {},
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    },
    onWake: (fn) => {
      wake = fn;
      return () => {
        wake = null;
      };
    },
  });
  return { conn, sockets, clock, wake: () => wake?.() };
}

const snapshotFrame = JSON.stringify({
  type: "snapshot",
  seq: 0,
  you: { campaignId: "c", role: "player", playerId: "p" },
  records: {},
});

test("FR-SYNC-05 a lost connection waits for the backoff", () => {
  const { conn, sockets, clock } = setup();
  conn.start();
  for (let i = 0; i < 6; i++) sockets.at(-1)?.close(1006);
  expect(sockets).toHaveLength(1);
  clock.advance(700);
  expect(sockets).toHaveLength(2);
});

test("FR-SYNC-05 SYNC §3 server down for a long time: every retry is ≤ 1.8 s after the last, so rejoin ≤ 2 s after the server answers", () => {
  const { conn, sockets, clock } = setup();
  conn.start();
  // Server unreachable for ~2 minutes of failed attempts.
  for (let i = 0; i < 60; i++) {
    sockets.at(-1)?.close(1006);
    const [wait] = clock.pending();
    expect(wait).toBeLessThanOrEqual(1_800);
    clock.advance(wait as number);
  }
  // Server back: the next attempt opens within 1.8 s, then a snapshot makes it live.
  sockets.at(-1)?.close(1006);
  const n = sockets.length;
  clock.advance(1_800);
  expect(sockets).toHaveLength(n + 1);
  sockets.at(-1)?.onmessage?.({ data: snapshotFrame });
  expect(conn.snapshot.state).toBe("live");
});

test("FR-SYNC-05 outage: after one failed WS attempt, only the HTTP probe runs (≤ 1.8 s apart) until the server answers; then exactly one WS", () => {
  let up = false;
  let probes = 0;
  const { conn, sockets, clock } = setup(() => {
    probes += 1;
    return up;
  });
  conn.start();
  (sockets[0] as FakeSocket).onopen?.();
  sockets[0]?.onmessage?.({ data: snapshotFrame });
  // Live connection drops (hard kill): first retry goes straight to a WebSocket (fast path).
  sockets[0]?.close(1006);
  clock.advance(600);
  expect(sockets).toHaveLength(2);
  expect(probes).toBe(0);
  // That attempt is refused → from now on probe only; no WS while unreachable (Chromium's
  // per-renderer WS throttle counts WS failures, not fetches).
  sockets[1]?.close(1006);
  for (let i = 0; i < 60; i++) {
    const [wait] = clock.pending();
    expect(wait).toBeLessThanOrEqual(1_800);
    clock.advance(wait as number);
  }
  expect(probes).toBe(60);
  expect(sockets).toHaveLength(2);
  expect(conn.snapshot.state).toBe("reconnecting");
  up = true;
  clock.advance(1_800);
  expect(sockets).toHaveLength(3);
  (sockets[2] as FakeSocket).onopen?.();
  sockets[2]?.onmessage?.({ data: snapshotFrame });
  expect(conn.snapshot.state).toBe("live");
  // Opened again → the next drop takes the fast path again.
  sockets[2]?.close(1006);
  clock.advance(600);
  expect(sockets).toHaveLength(4);
  expect(probes).toBe(61);
});

test("FR-SYNC-05 a probe still in flight when stopped (or a stale one) never opens a socket", async () => {
  let resolve!: (v: boolean) => void;
  const { conn, sockets, clock } = setup(
    () =>
      new Promise<boolean>((r) => {
        resolve = r;
      }),
  );
  conn.start();
  sockets[0]?.close(1006);
  clock.advance(600);
  expect(sockets).toHaveLength(1); // probing
  conn.stop();
  resolve(true);
  await Bun.sleep(0);
  expect(sockets).toHaveLength(1);
});

test("FR-SYNC-05 httpProbe: reachable iff GET <ws path>?probe=1 answers 204", async () => {
  const seen: string[] = [];
  const mk = (status: number) =>
    Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => {
        const u = new URL(req.url);
        seen.push(`${u.pathname}${u.search}`);
        return new Response(null, { status });
      },
    });
  const ok = mk(204);
  const upgradeRequired = mk(426);
  const proxyErr = mk(502);
  try {
    expect(await httpProbe(`ws://127.0.0.1:${ok.port}/ws`)).toBe(true);
    expect(await httpProbe(`ws://127.0.0.1:${upgradeRequired.port}/ws`)).toBe(false);
    expect(await httpProbe(`ws://127.0.0.1:${proxyErr.port}/ws`)).toBe(false);
    expect(seen).toEqual(["/ws?probe=1", "/ws?probe=1", "/ws?probe=1"]);
  } finally {
    ok.stop(true);
    upgradeRequired.stop(true);
    proxyErr.stop(true);
  }
  const closedPort = proxyErr.port;
  expect(await httpProbe(`ws://127.0.0.1:${closedPort}/ws`)).toBe(false);
});

test("SYNC §3 reconnect goal: online / focus / visible skips the remaining backoff", () => {
  const { conn, sockets, clock, wake } = setup();
  conn.start();
  // Several failed attempts → capped backoff (1.2–1.8 s, #131).
  for (let i = 0; i < 4; i++) {
    sockets.at(-1)?.close(1006);
    clock.advance(10_000);
  }
  sockets.at(-1)?.close(1006);
  const n = sockets.length;
  expect(Math.min(...clock.pending())).toBeGreaterThanOrEqual(1_200);
  wake();
  expect(sockets).toHaveLength(n + 1);
  expect(clock.pending()).toEqual([]);
  // Attempt in flight → another wake does nothing.
  wake();
  expect(sockets).toHaveLength(n + 1);
});

test("FR-SYNC-22 signals: sent only while live (never queued); incoming frames reach handlers with from", () => {
  const { conn, sockets } = setup();
  conn.start();
  const s = sockets[0] as FakeSocket;
  expect(conn.sendSignal("map.ping", { x: 1 })).toBe(false);
  expect(s.sent).toEqual([]);
  s.onmessage?.({ data: snapshotFrame });
  expect(conn.sendSignal("map.ping", { x: 1 })).toBe(true);
  expect(JSON.parse(s.sent.at(-1) as string)).toEqual({
    type: "signal",
    name: "map.ping",
    data: { x: 1 },
  });
  const got: unknown[] = [];
  const off = conn.onSignal((f) => got.push(f));
  const frame = { type: "signal", name: "map.ping", data: { x: 2 }, from: { role: "dm" } };
  s.onmessage?.({ data: JSON.stringify(frame) });
  // A frame without the server stamp is malformed and ignored.
  s.onmessage?.({ data: JSON.stringify({ ...frame, from: undefined }) });
  off();
  s.onmessage?.({ data: JSON.stringify(frame) });
  expect(got).toEqual([frame]);
});

test("wake never reconnects a rejected (4401) or stopped connection", () => {
  const { conn, sockets, wake } = setup();
  conn.start();
  sockets.at(-1)?.close(4401);
  wake();
  expect(sockets).toHaveLength(1);
  expect(conn.snapshot.state).toBe("rejected");
  const b = setup();
  b.conn.start();
  b.sockets.at(-1)?.close(1006);
  b.conn.stop();
  b.wake();
  expect(b.sockets).toHaveLength(1);
});
