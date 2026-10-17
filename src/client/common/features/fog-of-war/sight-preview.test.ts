// FR-FOG-54 sight preview, client: the preview replaces only T's polygons (by `src`) in T's owner's
// `vision`; the dragger keeps it through a 4 s rest, a refused cell and a mid-drag `vision` change
// (the probe re-sends the current cell) until the drop's answer or a cancel; receivers keep a
// `fog.sight` only beside T's drag preview, so it drops on `end`, `TokenMoved`, a snapshot and 3 s
// after the last `map.drag` (not after the last `fog.sight`).
import { describe, expect, test } from "bun:test";
import { DRAG_REPEAT_MS, DRAG_TIMEOUT_MS, FOG_SIGHT_HINT } from "@shared/scenes-map/schemas";
import {
  clearPreviews,
  createPreviewStore,
  prunePreviews,
  receiveDrag,
  tokenIdsOf,
} from "../scenes-map/drag-preview";
import { DragProbe, PROBE_DEBOUNCE_MS, PROBE_MIN_GAP_MS } from "../scenes-map/drag-probe";
import {
  clearRemote,
  createSightPreviewStore,
  followDrags,
  followProbe,
  previewList,
  previewVision,
  receiveSight,
} from "./sight-preview";

const sq = (x: number, y: number, s = 1) => [x, y, x + s, y, x + s, y + s, x, y + s];

describe("FR-FOG-54 previewVision", () => {
  const vision = {
    playerId: "p1",
    blind: false,
    // see: Mira, Kira; dark: Kira — `src` per polygon of see ++ dark.
    see: [sq(0, 0), sq(5, 5)],
    dark: [sq(5, 5, 3)],
    src: ["mira", "kira", "kira"],
    inv: [2],
  };
  const preview = (tokenId: string, ownerPlayerId: string | null, see = [sq(9, 9)]) => ({
    tokenId,
    ownerPlayerId,
    see,
    dark: [],
  });

  test("FR-FOG-54 preview replaces only T's polygons by src; other sources and inv stay (re-indexed)", () => {
    const r = previewVision(vision, [preview("mira", "p1")]);
    expect(r.applied).toEqual(["mira"]);
    expect(r.vision?.see).toEqual([sq(5, 5), sq(9, 9)]);
    expect(r.vision?.dark).toEqual([sq(5, 5, 3)]);
    expect(r.vision?.src).toEqual(["kira", "mira", "kira"]);
    expect(r.vision?.inv).toEqual([2]); // Kira's dark polygon, still last
    // Kira's preview: both her polygons go, her preview has no dark polygon.
    const k = previewVision(vision, [preview("kira", "p1")]);
    expect(k.vision?.see).toEqual([sq(0, 0), sq(9, 9)]);
    expect(k.vision?.dark).toEqual([]);
    expect(k.vision?.inv).toEqual([]);
  });

  test("FR-FOG-54 another player's token leaves the record alone; no record → nothing; a blind record with preview polygons sees", () => {
    expect(previewVision(vision, [preview("thorn", "p2")])).toEqual({ vision, applied: [] });
    expect(previewVision(null, [preview("mira", "p1")])).toEqual({ vision: null, applied: [] });
    const blind = { playerId: "p1", blind: true, see: [], dark: [], src: [] };
    expect(previewVision(blind, [preview("mira", "p1")]).vision?.blind).toBe(false);
    expect(previewVision(blind, [preview("mira", "p1", [])]).vision?.blind).toBe(true);
  });

  test("FR-FOG-54 previewList pairs each preview with its token's owner; unknown tokens are skipped", () => {
    const st = {
      local: { tokenId: "mira", see: [sq(1, 1)], dark: [] },
      remote: { thorn: { see: [], dark: [sq(2, 2)] }, gone: { see: [], dark: [] } },
    };
    const owners: Record<string, string> = { mira: "p1", thorn: "p2" };
    expect(previewList(st, (id) => owners[id]).map((p) => [p.tokenId, p.ownerPlayerId])).toEqual([
      ["thorn", "p2"],
      ["mira", "p1"],
    ]);
  });
});

/** A probe on a fake clock; acks resolved by the test. */
function dragger() {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const sent: { col: number; row: number }[] = [];
  const answers: ((v: unknown) => void)[] = [];
  const probe = new DragProbe({
    check: (_id, to) => {
      sent.push(to);
      return new Promise((res) => answers.push(res));
    },
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++ids;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = end;
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const s = createSightPreviewStore();
  followProbe(s, probe);
  const sight = (see: number[][]) => ({
    ok: true,
    hints: [{ guard: FOG_SIGHT_HINT, tokenId: "mira", see, dark: [] }],
  });
  return { probe, s, sent, answers, advance, flush, sight };
}

describe("FR-FOG-54 dragger lifetime", () => {
  test("FR-FOG-54 the dragger keeps its preview through a 4 s rest and a refused cell; a mid-drag vision change re-sends checkMove for the current cell", async () => {
    const h = dragger();
    h.probe.start("mira", { col: 2, row: 7 }, true);
    h.probe.move({ col: 7, row: 5 });
    h.advance(PROBE_DEBOUNCE_MS);
    h.answers[0]?.(h.sight([sq(7, 5, 3)]));
    await h.flush();
    expect(h.s.getState().local).toEqual({ tokenId: "mira", see: [sq(7, 5, 3)], dark: [] });
    h.advance(4000); // rests: nothing expires
    expect(h.s.getState().local?.see).toEqual([sq(7, 5, 3)]);
    // Across the wall: refused, no sight hint → the last legal cell's preview stays.
    h.probe.move({ col: 9, row: 7 });
    h.advance(PROBE_MIN_GAP_MS);
    h.answers[1]?.({ ok: false, hints: [] });
    await h.flush();
    expect(h.s.getState().local?.see).toEqual([sq(7, 5, 3)]);
    // A `vision` change for the player (a door opened): the host calls recheck → same cell again.
    h.probe.recheck();
    h.advance(PROBE_MIN_GAP_MS);
    expect(h.sent.at(-1)).toEqual({ col: 9, row: 7 });
    expect(h.sent).toHaveLength(3);
    h.answers[2]?.(h.sight([sq(9, 7, 2)]));
    await h.flush();
    expect(h.s.getState().local?.see).toEqual([sq(9, 7, 2)]);
  });

  test("FR-FOG-54 the dragger drops its preview on the drop's answer (not before), at once on a cancel, and on a snapshot", async () => {
    const h = dragger();
    const show = async () => {
      h.probe.start("mira", { col: 2, row: 7 }, true);
      h.probe.move({ col: 3, row: 7 });
      h.advance(PROBE_MIN_GAP_MS);
      h.answers.at(-1)?.(h.sight([sq(3, 7)]));
      await h.flush();
      expect(h.s.getState().local).not.toBeNull();
    };
    await show();
    let answer: (v: unknown) => void = () => {};
    h.probe.finish(new Promise((r) => (answer = r)));
    await h.flush();
    expect(h.s.getState().local).not.toBeNull(); // TokenMoved / ack not in yet
    answer({});
    await h.flush();
    expect(h.s.getState().local).toBeNull();
    await show();
    h.probe.finish(); // Esc / snap-back
    await h.flush();
    expect(h.s.getState().local).toBeNull();
    await show();
    h.probe.snapshot();
    expect(h.s.getState().local).toBeNull();
    // A rejected drop drops it too.
    await show();
    h.probe.finish(Promise.reject(new Error("conflict")));
    await h.flush();
    expect(h.s.getState().local).toBeNull();
  });
});

describe("FR-FOG-54 receivers", () => {
  const view = (previews: ReturnType<typeof createPreviewStore>) => ({
    sceneId: "ambush",
    previewing: (id: string) => id in previews.getState().previews,
  });
  const frame = { sceneId: "ambush", tokenId: "thorn", see: [], dark: [sq(2, 9, 4)] };
  const setup = () => {
    const previews = createPreviewStore();
    const s = createSightPreviewStore();
    followDrags(s, previews);
    const drag = (now: number) =>
      receiveDrag(
        previews,
        { sceneId: "ambush", tokenId: "thorn", x: 140, y: 630 },
        { sceneId: "ambush", hasToken: () => true, draggingId: null },
        now,
      );
    return { previews, s, drag };
  };

  test("FR-FOG-54 a fog.sight counts only beside T's drag preview; another scene is ignored", () => {
    const r = setup();
    receiveSight(r.s, frame, view(r.previews));
    expect(r.s.getState().remote).toEqual({});
    r.drag(0);
    receiveSight(r.s, { ...frame, sceneId: "town" }, view(r.previews));
    expect(r.s.getState().remote).toEqual({});
    receiveSight(r.s, frame, view(r.previews));
    expect(r.s.getState().remote.thorn?.dark).toEqual([sq(2, 9, 4)]);
  });

  test("FR-FOG-54 receivers drop it 3 s after the last map.drag for T (not the last fog.sight), on end and on TokenMoved; leaving live clears", () => {
    const r = setup();
    r.drag(0);
    receiveSight(r.s, frame, view(r.previews));
    // map.drag repeats every 1 s at rest: the preview stays although no fog.sight follows.
    for (let t = DRAG_REPEAT_MS; t <= 5000; t += DRAG_REPEAT_MS) {
      r.drag(t);
      prunePreviews(r.previews, t);
    }
    expect(r.s.getState().remote.thorn).toBeDefined();
    // The frames stop: 3 s after the last map.drag it goes.
    prunePreviews(r.previews, 5000 + DRAG_TIMEOUT_MS - 1);
    expect(r.s.getState().remote.thorn).toBeDefined();
    prunePreviews(r.previews, 5000 + DRAG_TIMEOUT_MS);
    expect(r.s.getState().remote).toEqual({});
    // `end`.
    r.drag(9000);
    receiveSight(r.s, frame, view(r.previews));
    receiveDrag(
      r.previews,
      { sceneId: "ambush", tokenId: "thorn", end: true },
      { sceneId: "ambush", hasToken: () => true, draggingId: null },
      9100,
    );
    expect(r.s.getState().remote).toEqual({});
    // The drop's TokenMoved (any `token` change for T) drops the drag preview, and so the sight.
    r.drag(9200);
    receiveSight(r.s, frame, view(r.previews));
    clearPreviews(r.previews, tokenIdsOf([{ type: "token", id: "thorn" }]));
    expect(r.s.getState().remote).toEqual({});
    // Leaving live.
    r.drag(9300);
    receiveSight(r.s, frame, view(r.previews));
    clearRemote(r.s);
    expect(r.s.getState().remote).toEqual({});
  });
});
