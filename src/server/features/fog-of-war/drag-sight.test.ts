// FOG §13 sprint-4 sight preview (V8, FR-FOG-53): `map.checkMove`'s hint phase returns fog's
// `fog-sight` hint and the hub fans it out as `fog.sight` over real sockets (`vision-party`,
// Goblin Ambush active; `player-1` = Mira (2, 7), `player-2` = Thorn (2, 9); wall x = 8 with
// door d1 (8, 5)–(8, 6)). Read-only (digest), audience (active scene, holders, owner / party,
// never the DM), the DM drag as the owner, the hint phase after every guard, order against
// `TokenMoved`, drop-not-delay, drag traffic within FOG §12, and a hard kill mid-drag.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { answer, visionHarness, visionServices } from "@fixtures/units/fog-of-war/vision-harness";
import { FOG_INTENTS as F, FOG_SIGNALS, type FogSightPayload } from "@shared/fog-of-war/schemas";
import type { ServerFrame } from "@shared/protocol/frames";
import {
  type CheckMoveResult,
  FOG_SIGHT_HINT,
  type FogSightHint,
  MAP_INTENTS as I,
  MAP_SIGNALS,
} from "@shared/scenes-map/schemas";
import { armCrashHook } from "../../commands/crash";
import { stateDigest } from "../../db/digest";
import { token } from "../../db/schema";
import { tokenMoveGuards } from "../scenes-map/move-guards";
import { previewsComputed } from "./sight-hint";
import { fogSightAudience } from "./sight-signal";
import { clearVisionCache, PREVIEW_CACHE_MAX, previewCacheSize } from "./vision-cache";

type Who = "p1" | "p2";
type Frame = ServerFrame;

const sightHint = (r: CheckMoveResult | undefined) =>
  r?.hints.find((h): h is FogSightHint => h.guard === FOG_SIGHT_HINT);
const maxX = (polys: readonly (readonly number[])[]) =>
  Math.max(...polys.flatMap((p) => p.filter((_, i) => i % 2 === 0)));
const bytes = (f: unknown) => new TextEncoder().encode(JSON.stringify(f)).length;

function sightsOf(frames: readonly Frame[], from = 0): FogSightPayload[] {
  return frames
    .slice(from)
    .flatMap((f) =>
      f.type === "signal" && f.name === FOG_SIGNALS.sight ? [f.data as FogSightPayload] : [],
    );
}

async function harness() {
  const t = await visionHarness("vision-party");
  const check = async (who: "dm" | Who, name: string, col: number, row: number, id?: string) => {
    const c = who === "dm" ? t.dm : t.c[who];
    const a = await t.send(c, I.checkMove, { tokenId: id ?? t.id(name), col, row });
    await Bun.sleep(20);
    return a as Extract<Frame, { type: "ack" | "reject" }>;
  };
  const result = (a: Extract<Frame, { type: "ack" | "reject" }>) =>
    (a as { result?: CheckMoveResult }).result;
  const sights = (w: Who, from: number) => sightsOf(t.c[w].frames, from);
  const dmSignals = (from: number) => t.dm.frames.slice(from).filter((f) => f.type === "signal");
  const digest = () => stateDigest(t.db.$client).sha256;
  return { ...t, check, result, sights, dmSignals, digest };
}

describe("FR-FOG-53 sight preview (party off, then on)", () => {
  let t: Awaited<ReturnType<typeof harness>>;
  beforeAll(async () => {
    t = await harness();
  });
  afterAll(async () => {
    await t.stop();
  });

  test("FR-FOG-53 P1 checkMove Mira → (7, 5) with d1 open: fog-sight reaching x > 8, no Goblin upsert, no seq, no write; across the wall → ok false, no sight; P2 none (off) then one (on); never the DM", async () => {
    await t.setDoor(0); // d1 open
    const d0 = t.digest();
    const m = t.mark();
    const dm0 = t.dm.frames.length;
    const a = await t.check("p1", "Mira", 7, 5);
    expect(a.type).toBe("ack");
    const r = t.result(a);
    expect(r?.ok).toBe(true);
    const h = sightHint(r);
    expect(h?.tokenId).toBe(t.id("Mira"));
    expect(maxX(h?.see ?? [])).toBeGreaterThan(8);
    expect(h?.dark).toEqual([]); // Mira: vision 30 ft, no darkvision
    // Read-only: no event (no `seq`), no Goblin, nothing written.
    expect(t.events(t.c.p1, m.p1)).toEqual([]);
    expect(t.names(t.c.p1)).not.toContain("Goblin");
    expect(t.digest()).toBe(d0);
    // Across the wall (closed part of x = 8): refused, no sight hint at all.
    const across = t.result(await t.check("p1", "Mira", 9, 7));
    expect(across?.ok).toBe(false);
    expect(sightHint(across)).toBeUndefined();
    // Party off: nobody else gets `fog.sight` for the owner's own drag.
    expect(t.sights("p2", m.p2)).toEqual([]);
    expect(t.sights("p1", m.p1)).toEqual([]);
    // Party on: P2 (a holder) gets it, with the same polygons as the ack's hint.
    await t.ok(t.dm, F.setPartyVision, { on: true });
    const m2 = t.mark();
    const on = sightHint(t.result(await t.check("p1", "Mira", 7, 6)));
    const got = t.sights("p2", m2.p2);
    expect(got).toHaveLength(1);
    expect(got[0]).toEqual({
      sceneId: t.ambushId,
      tokenId: t.id("Mira"),
      see: on?.see ?? [],
      dark: [],
    });
    expect(t.sights("p1", m2.p1)).toEqual([]);
    expect(
      t.dmSignals(dm0).filter((f) => f.type === "signal" && f.name === FOG_SIGNALS.sight),
    ).toEqual([]);
    await t.ok(t.dm, F.setPartyVision, { on: false });
    await t.setDoor(1);
  });

  test("FR-FOG-53 DM drag as owner: the DM's checkMove for Thorn (2, 9) → (11, 9) across x = 8 is ok but has no sight hint and P2 gets nothing; → (4, 10) the hint and P2's fog.sight (owner), not P1, not the DM", async () => {
    await Bun.sleep(1000); // a fresh rate window per receiver
    const m = t.mark();
    const dm0 = t.dm.frames.length;
    const east = t.result(await t.check("dm", "Thorn", 11, 9));
    expect(east).toEqual({ ok: true, hints: [] });
    expect(t.sights("p2", m.p2)).toEqual([]);
    const west = t.result(await t.check("dm", "Thorn", 4, 10));
    expect(west?.ok).toBe(true);
    const h = sightHint(west);
    expect(h?.dark.length).toBe(1); // Thorn: darkvision only (stored vision 0)
    expect(t.sights("p2", m.p2)).toEqual([
      { sceneId: t.ambushId, tokenId: t.id("Thorn"), see: h?.see ?? [], dark: h?.dark ?? [] },
    ]);
    expect(t.sights("p2", m.p2).length).toBe(1);
    expect(t.sights("p1", m.p1)).toEqual([]);
    expect(t.dmSignals(dm0)).toEqual([]);
    // An unowned token: no sight hint (not a source), no signal.
    const gob = t.result(await t.check("dm", "Goblin", 12, 5));
    expect(sightHint(gob)).toBeUndefined();
  });

  test("FR-FOG-53 audience: active scene, holders only: a prep-scene DM drag reaches no player; party on, a party-blind party or a player whose store lacks T gets nothing", async () => {
    await Bun.sleep(1000);
    await t.ok(t.dm, F.setPartyVision, { on: true });
    const town = t.db
      .select()
      .from(token)
      .all()
      .find((x) => x.name === "Mira" && x.sceneId !== t.ambushId);
    expect(town).toBeDefined();
    let m = t.mark();
    // The DM drags Mira on Town (prep): the DM's ack has the sight, but no player frame at all.
    const prep = t.result(
      await t.check("dm", "Mira", (town?.col ?? 0) + 1, town?.row ?? 0, town?.id),
    );
    expect(sightHint(prep)).toBeDefined();
    await Bun.sleep(50);
    expect(t.c.p1.frames.length).toBe(m.p1);
    expect(t.c.p2.frames.length).toBe(m.p2);
    // A holder set without P2 (party on): P2 is left out (the audience reads `seenBy` + owner).
    const ambushMira = t.db
      .select()
      .from(token)
      .all()
      .find((x) => x.id === t.id("Mira"));
    const sender = { role: "dm" as const, playerId: null };
    expect(
      fogSightAudience(
        t.db,
        { ...(ambushMira as typeof token.$inferSelect), seenBy: [t.pid.p1] },
        sender,
      ),
    ).toEqual([t.pid.p1]);
    // Party-blind: both PCs in the darkness, Thorn without see-through → nobody.
    await t.senses("Thorn", { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: false });
    await t.move(t.dm, "Mira", 12, 9);
    await t.move(t.dm, "Thorn", 11, 9);
    await Bun.sleep(1000);
    m = t.mark();
    await t.check("dm", "Thorn", 11, 10);
    await t.check("p1", "Mira", 12, 10);
    expect(t.sights("p1", m.p1)).toEqual([]);
    expect(t.sights("p2", m.p2)).toEqual([]);
    await t.senses("Thorn", {
      visionFt: 0,
      darkvisionFt: 60,
      seesMagicalDarkness: true,
      seesInvisible: true,
    });
    await t.move(t.dm, "Mira", 2, 7);
    await t.move(t.dm, "Thorn", 2, 9);
    await t.ok(t.dm, F.setPartyVision, { on: false });
  });

  test("FR-FOG-53 hint phase: a refusing guard registered after fog → no fog-sight hint and no fog.sight", async () => {
    await Bun.sleep(1000);
    await t.ok(t.dm, F.setPartyVision, { on: true });
    tokenMoveGuards.register("test.refuse-after-fog", () => ({ refuse: "No" }));
    try {
      const m = t.mark();
      const r = t.result(await t.check("p1", "Mira", 3, 7));
      expect(r).toEqual({ ok: false, hints: [] });
      const dm = t.result(await t.check("dm", "Thorn", 3, 9));
      expect(dm).toEqual({ ok: false, hints: [] });
      expect(t.sights("p2", m.p2)).toEqual([]);
      expect(t.sights("p1", m.p1)).toEqual([]);
    } finally {
      tokenMoveGuards.unregister("test.refuse-after-fog");
      await t.ok(t.dm, F.setPartyVision, { on: false });
    }
  });
});

describe("FR-FOG-53 order, rate and traffic (party on)", () => {
  let t: Awaited<ReturnType<typeof harness>>;
  beforeAll(async () => {
    t = await harness();
    await t.ok(t.dm, F.setPartyVision, { on: true });
  });
  afterAll(async () => {
    await t.stop();
  });

  test("FR-FOG-53 order: > 4 / s → the excess dropped, never delayed; a fog.sight throttled just before the drop never follows TokenMoved", async () => {
    const m = t.mark();
    // 8 checks back to back for Mira: P2 gets ≤ 4 in the second, the rest dropped.
    for (const [col, row] of [
      [3, 7],
      [4, 7],
      [3, 6],
      [4, 6],
      [3, 8],
      [4, 8],
      [5, 7],
      [5, 6],
    ] as const) {
      await t.check("p1", "Mira", col, row);
    }
    expect(t.sights("p2", m.p2).length).toBe(4);
    // Drop now: TokenMoved, then `end`.
    await t.move(t.c.p1, "Mira", 5, 6);
    t.drag(t.c.p1, "Mira", "end");
    await Bun.sleep(1200); // anything held would have been sent by now
    for (const w of ["p2"] as const) {
      const frames = t.c[w].frames.slice(m[w]);
      const moved = frames.findIndex((f) => f.type === "event" && f.cause.name === "TokenMoved");
      expect(moved).toBeGreaterThan(-1);
      const lastSight = frames.findLastIndex(
        (f) => f.type === "signal" && f.name === FOG_SIGNALS.sight,
      );
      expect(lastSight).toBeLessThan(moved);
    }
    expect(sightsOf(t.c.p2.frames, m.p2).length).toBe(4);
    await t.move(t.c.p1, "Mira", 2, 7);
  });

  test("FR-FOG-53 drag traffic: a scripted 30-cell drag in 3 s → map.drag ≤ 20 / s, map.checkMove ≤ 10 / s one in flight, fog.sight ≤ 4 / s per receiver, frame sizes within FOG §12; map.drag keeps its fields", async () => {
    await Bun.sleep(1000);
    const m = t.mark();
    const p1 = t.c.p1;
    const mira = t.id("Mira");
    const cells: [number, number][] = [];
    for (let i = 0; i < 30; i++) cells.push([2 + (i % 5), 3 + Math.floor(i / 5)]);
    const start = Date.now();
    const checkTimes: number[] = [];
    const ackBytes: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let lastCheck = -Infinity;
    let wanted: [number, number] | null = null;
    let lastDrag = -Infinity;
    const pump = async () => {
      // The client probe's pacing (FR-MAP-39): one in flight, ≥ 100 ms apart, newest cell wins.
      if (inFlight > 0 || !wanted || Date.now() - lastCheck < 100) return;
      const [col, row] = wanted;
      wanted = null;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      lastCheck = Date.now();
      checkTimes.push(lastCheck - start);
      const a = await answer(p1, p1.intent(I.checkMove, { tokenId: mira, col, row }));
      ackBytes.push(bytes(a));
      inFlight--;
    };
    const pending: Promise<void>[] = [];
    while (Date.now() - start < 3000) {
      const i = Math.min(29, Math.floor((Date.now() - start) / 100));
      const [col, row] = cells[i] as [number, number];
      if (!wanted || wanted[0] !== col || wanted[1] !== row) wanted = [col, row];
      if (Date.now() - lastDrag >= 50) {
        lastDrag = Date.now();
        t.drag(p1, "Mira", [col + 0.3, row + 0.2]);
      }
      pending.push(pump());
      await Bun.sleep(10);
    }
    await Promise.all(pending);
    t.drag(p1, "Mira", "end");
    await Bun.sleep(200);
    const perSecond = (times: number[], max: number) => {
      for (let t0 = times[0] ?? 0; t0 <= (times.at(-1) ?? 0); t0 += 50) {
        expect(times.filter((x) => x >= t0 && x < t0 + 1000).length).toBeLessThanOrEqual(max);
      }
    };
    perSecond(checkTimes, 10);
    expect(maxInFlight).toBe(1);
    expect(checkTimes.length).toBeGreaterThan(15);
    // Receivers (P2): map.drag ≤ 20 / s with exactly its sprint-3 fields; fog.sight ≤ 4 / s.
    const recv = t.c.p2.frames.slice(m.p2);
    const drags = recv.filter((f) => f.type === "signal" && f.name === MAP_SIGNALS.drag);
    expect(drags.length).toBeGreaterThan(30);
    expect(drags.length).toBeLessThanOrEqual(61);
    for (const f of drags) {
      const keys = Object.keys((f as { data: object }).data).sort();
      expect([
        ["sceneId", "tokenId", "x", "y"],
        ["end", "sceneId", "tokenId"],
      ]).toContainEqual(keys);
    }
    const sights = recv.filter((f) => f.type === "signal" && f.name === FOG_SIGNALS.sight);
    expect(sights.length).toBeGreaterThan(4);
    expect(sights.length).toBeLessThanOrEqual(4 * 4); // ≤ 4 / s over ≤ 4 started seconds
    // Frame sizes (FOG §12 typical: ack 372–558 B, fog.sight the same order; drag ≈ 243 B).
    expect(Math.max(...ackBytes)).toBeLessThanOrEqual(1024);
    expect(Math.max(...sights.map(bytes))).toBeLessThanOrEqual(1024);
    expect(Math.max(...drags.map(bytes))).toBeLessThanOrEqual(300);
    await t.move(t.c.p1, "Mira", 2, 7);
  });
});

describe("FR-FOG-53 preview cache and crash (in-process)", () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    armCrashHook(null);
    for (const stop of stops.splice(0)) stop();
    clearVisionCache();
  });

  test("FR-FOG-38 preview cache: own LRU (≤ 64), keyed by cell; a hit recomputes nothing; players' sight cache untouched", async () => {
    const v = await visionServices("vision-party");
    stops.push(v.stop);
    clearVisionCache();
    const mira = v.tokenRow("Mira").id;
    const n0 = previewsComputed();
    v.run(I.checkMove, { tokenId: mira, col: 3, row: 7 }, v.actor("p1"));
    v.run(I.checkMove, { tokenId: mira, col: 3, row: 7 }, v.actor("p1"));
    expect(previewsComputed()).toBe(n0 + 1);
    for (let c = 0; c < 10; c++) {
      for (let r = 0; r < 8; r++)
        v.run(I.checkMove, { tokenId: mira, col: c, row: r }, v.actor("p1"));
    }
    expect(previewCacheSize()).toBeLessThanOrEqual(PREVIEW_CACHE_MAX);
  });

  test("FR-FOG-53 no write on crash mid-drag (digest): checks flow, then a kill at map.checkMove before / after commit → digest and snapshots equal the pre-drag state", async () => {
    const v = await visionServices("vision-party");
    stops.push(v.stop);
    v.run(F.setPartyVision, { on: true });
    const kill = () => {
      throw new Error("killed");
    };
    const digest = () => stateDigest(v.db.$client).sha256;
    const snaps = () => JSON.stringify([v.snapshot("p1"), v.snapshot("p2"), v.snapshot("dm")]);
    const d0 = digest();
    const s0 = snaps();
    const mira = v.tokenRow("Mira").id;
    const thorn = v.tokenRow("Thorn").id;
    for (const col of [3, 4, 5]) v.run(I.checkMove, { tokenId: mira, col, row: 7 }, v.actor("p1"));
    for (const col of [3, 4]) v.run(I.checkMove, { tokenId: thorn, col, row: 9 });
    for (const point of ["before-commit", "after-commit"] as const) {
      armCrashHook({ point, target: I.checkMove }, kill);
      expect(() => v.run(I.checkMove, { tokenId: mira, col: 6, row: 7 }, v.actor("p1"))).toThrow();
      armCrashHook(null);
    }
    clearVisionCache(); // the restart
    expect(digest()).toBe(d0);
    expect(snaps()).toBe(s0);
  });
});
