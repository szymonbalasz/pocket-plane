// Animated tokens, playback pool (ANIM §13): one video per asset ID, still until it can play,
// still on error, pause when unused, release after 60 s, hidden tab, reconnect retry.
import { describe, expect, test } from "bun:test";
import { RELEASE_MS, type VideoLike, VideoPool } from "./video-pool";

class FakeVideo implements VideoLike {
  src = "";
  muted = false;
  loop = false;
  playsInline = false;
  preload = "";
  paused = true;
  plays = 0;
  private handlers = new Map<string, (() => void)[]>();
  play() {
    this.plays += 1;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  addEventListener(type: string, fn: () => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  fire(type: string) {
    for (const fn of this.handlers.get(type) ?? []) fn();
  }
}

function setup() {
  const made: FakeVideo[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  let hidden = false;
  const pool = new VideoPool<FakeVideo>({
    make: () => {
      const v = new FakeVideo();
      made.push(v);
      return v;
    },
    hidden: () => hidden,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
  });
  const runTimers = () => {
    for (const t of timers.splice(0)) if (!t.cleared) t.fn();
  };
  return {
    pool,
    made,
    timers,
    runTimers,
    setHidden: (h: boolean) => {
      hidden = h;
    },
  };
}

describe("FR-ANIM-12 one video per asset", () => {
  test("FR-ANIM-12 two users share one muted looping element on /motion; ready only after canplay", () => {
    const { pool, made } = setup();
    const a = pool.acquire("A1");
    const b = pool.acquire("A1");
    expect(made).toHaveLength(1);
    const v = made[0] as FakeVideo;
    expect(v.src).toBe("/api/assets/A1/motion");
    expect([v.muted, v.loop, v.playsInline]).toEqual([true, true, true]);
    expect(pool.element("A1")).toBeNull();
    expect(pool.state("A1")).toBe("loading");
    v.fire("canplay");
    expect(pool.element("A1")).toBe(v);
    expect(v.paused).toBe(false);
    a();
    b();
  });

  test("FR-ANIM-15 an error leaves the still (no element), no retry loop; a reconnect retries once", () => {
    const { pool, made } = setup();
    pool.acquire("A2");
    const v = made[0] as FakeVideo;
    let pings = 0;
    pool.subscribe("A2", () => {
      pings += 1;
    });
    v.fire("error");
    expect(pool.state("A2")).toBe("error");
    expect(pool.element("A2")).toBeNull();
    expect(made).toHaveLength(1);
    pool.retryErrors();
    expect(made).toHaveLength(2);
    expect(pool.state("A2")).toBe("loading");
    expect(pings).toBe(2);
  });
});

describe("FR-ANIM-13 plays only while shown", () => {
  test("FR-ANIM-13 the last user leaving pauses; 60 s later the element is released; a new user in time keeps it", () => {
    const { pool, made, timers, runTimers } = setup();
    const off = pool.acquire("A3");
    const v = made[0] as FakeVideo;
    v.fire("canplay");
    off();
    expect(v.paused).toBe(true);
    expect(timers[0]?.ms).toBe(RELEASE_MS);
    // Back before the timer: same element, playing again.
    const again = pool.acquire("A3");
    expect(made).toHaveLength(1);
    expect(v.paused).toBe(false);
    runTimers();
    expect(pool.size()).toBe(1);
    again();
    runTimers();
    expect(pool.size()).toBe(0);
    expect(v.src).toBe("");
  });

  test("FR-ANIM-13 a hidden tab pauses every video; visible again resumes only used ones", () => {
    const { pool, made, setHidden } = setup();
    const offA = pool.acquire("A4");
    const offB = pool.acquire("A5");
    offB();
    const [a, b] = made as [FakeVideo, FakeVideo];
    setHidden(true);
    pool.visibilityChanged();
    expect([a.paused, b.paused]).toEqual([true, true]);
    setHidden(false);
    pool.visibilityChanged();
    expect([a.paused, b.paused]).toEqual([false, true]);
    offA();
  });

  test("FR-ANIM-13 release is idempotent", () => {
    const { pool, made } = setup();
    const off = pool.acquire("A6");
    const keep = pool.acquire("A6");
    off();
    off();
    expect((made[0] as FakeVideo).paused).toBe(false);
    keep();
    expect((made[0] as FakeVideo).paused).toBe(true);
  });
});
