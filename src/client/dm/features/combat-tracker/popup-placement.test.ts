import { describe, expect, test } from "bun:test";
import { coveredArea } from "@ui/features/play-shell/token-boxes";
import {
  clampIntoWorkArea,
  dragPopup,
  originPlacement,
  placementTiers,
  placementTokenIds,
  popupPlacement,
} from "./popup-placement";

const viewport = { w: 1440, h: 900 };
const base = { viewport, initiative: null, width: 440 };
/** 30 px tokens centred on each x, mid-height. */
const at = (xs: number[]) => xs.map((x) => ({ x: x - 15, y: 400, w: 30, h: 30 }));

describe("FR-CBT-55 popup placement", () => {
  test("FR-CBT-55 targets right of centre → left edge, clear of the tool rail", () => {
    const p = popupPlacement({ ...base, tokens: at([1000, 1100]) });
    expect(p).toMatchObject({ side: "left", x: 68 });
    // Vertically: the work area below the top bar, above the launcher.
    expect([p.top, p.bottom]).toEqual([60, 836]);
  });

  test("FR-CBT-55 targets left of centre → right edge, just left of an open Initiative window", () => {
    expect(popupPlacement({ ...base, tokens: at([200, 500]) })).toMatchObject({
      side: "right",
      x: 1440 - 12 - 440,
    });
    const initiative = { x: 1028, w: 400 };
    const p = popupPlacement({ ...base, tokens: at([200]), initiative });
    expect(p.side).toBe("right");
    expect(p.x + 440).toBeLessThanOrEqual(initiative.x);
  });

  test("FR-CBT-55 no token → left; the mean decides for spread targets", () => {
    expect(popupPlacement({ ...base, tokens: at([]) }).side).toBe("left");
    expect(popupPlacement({ ...base, tokens: at([100, 1300, 1350]) }).side).toBe("left");
    // Never past the left edge when the Initiative window is wide on a narrow screen.
    const narrow = popupPlacement({
      viewport: { w: 600, h: 700 },
      tokens: at([100]),
      initiative: { x: 300, w: 288 },
      width: 440,
    });
    expect(narrow.x).toBe(68);
  });
});

describe("FR-CBT-56 placement by overlap (walkthrough step 8)", () => {
  // 1440×900, Scenes + Creatures + Log open: the map fits into x 528–1028; Initiative at 1028.
  const initiative = { x: 1028, w: 400 };
  const mira = { x: 807, y: 442, w: 29, h: 29 };
  const thorn = { x: 573, y: 501, w: 29, h: 29 };
  const overlaps = (p: { x: number }, t: { x: number; w: number }) =>
    p.x < t.x + t.w && t.x < p.x + 440;

  test("FR-CBT-56 step 8: likely targets left of centre but under 'left of Initiative' → left edge, covering neither", () => {
    const p = popupPlacement({ ...base, initiative, tokens: [mira, thorn] });
    expect(p).toMatchObject({ side: "left", x: 68 });
    expect(overlaps(p, mira) || overlaps(p, thorn)).toBe(false);
  });

  test("FR-CBT-56 least overlap wins; a tie keeps the side rule", () => {
    // Tokens far left: both edges clear → the side rule (right, away from them).
    expect(popupPlacement({ ...base, initiative, tokens: at([30, 40]) })).toMatchObject({
      side: "right",
      x: 1028 - 12 - 440,
    });
    // Tokens near both edges: a spot beside them covers none.
    const p = popupPlacement({ ...base, tokens: at([100, 1300]) });
    expect(at([100, 1300]).some((t) => overlaps(p, t))).toBe(false);
    // Covering is unavoidable (a narrow screen): the spot covering the least (22 px of the small
    // token, none of the big one), not either edge.
    const narrow = popupPlacement({
      viewport: { w: 700, h: 700 },
      tokens: [
        { x: 100, y: 300, w: 30, h: 30 },
        { x: 560, y: 300, w: 60, h: 60 },
      ],
      initiative: null,
      width: 440,
    });
    expect(narrow).toMatchObject({ side: "left", x: 108 });
  });

  test("FR-CBT-56 tokens outside the work area's height count nothing; still fits the work area", () => {
    const above = { x: 100, y: 10, w: 30, h: 30 }; // under the top bar
    // Nothing covered anywhere → the side rule (away from the token: right).
    const p = popupPlacement({ ...base, tokens: [above] });
    expect(p).toMatchObject({ side: "right", x: 988, top: 60, bottom: 836 });
  });
});

describe("FR-CBT-56 likely targets", () => {
  const k = (id: string, kind: "pc" | "monster", tokenId: string | null, o: object = {}) => ({
    id,
    encounterId: "e1",
    kind,
    tokenId,
    name: id,
    active: true,
    removed: false,
    ...o,
  });
  const combatants = [
    k("Goblin", "monster", "t-gob"),
    k("Goblin 2", "monster", "t-gob2"),
    k("Mira", "pc", "t-mira"),
    k("Thorn", "pc", "t-thorn"),
    k("Ghost", "pc", null),
    k("Gone", "pc", "t-gone", { removed: true }),
    k("Far", "pc", "t-far"),
    k("Old", "pc", "t-old", { encounterId: "e0" }),
  ];
  const sceneOf = (t: string) => (t === "t-far" ? "s2" : "s1");
  const ids = (
    attackerId: string,
    rowTokenIds: string[] = [],
    viewedSceneId: string | null = "s1",
  ) =>
    placementTokenIds({
      rowTokenIds,
      combatants,
      encounterId: "e1",
      attackerId,
      tokenSceneOf: sceneOf,
      viewedSceneId,
    });
  // Screen x per token: PCs left of centre, monsters right.
  const xs: Record<string, number> = {
    "t-mira": 200,
    "t-thorn": 300,
    "t-gob": 1000,
    "t-gob2": 1100,
  };
  const side = (tokenIds: string[]) =>
    popupPlacement({ ...base, tokens: at(tokenIds.map((t) => xs[t] ?? 0)) }).side;

  test("FR-CBT-56 likely targets: monster attacker, PCs left → right", () => {
    expect(ids("Goblin")).toEqual(["t-mira", "t-thorn"]);
    expect(side(ids("Goblin"))).toBe("right");
  });

  test("FR-CBT-56 likely targets: PC attacker, monsters right → left", () => {
    expect(ids("Mira")).toEqual(["t-gob", "t-gob2"]);
    expect(side(ids("Mira"))).toBe("left");
  });

  test("FR-CBT-56 likely targets: removed, token-less, other-scene, other encounter ignored", () => {
    // Ghost (no token), Gone (removed), Far (other scene), Old (other encounter) never count.
    expect(ids("Goblin")).not.toContain("t-gone");
    expect(ids("Goblin")).not.toContain("t-far");
    expect(ids("Goblin")).not.toContain("t-old");
  });

  test("FR-CBT-56 likely targets: none → left", () => {
    const lone = [k("Goblin", "monster", "t-gob")];
    const none = placementTokenIds({
      rowTokenIds: [],
      combatants: lone,
      encounterId: "e1",
      attackerId: "Goblin",
      tokenSceneOf: sceneOf,
      viewedSceneId: "s1",
    });
    expect(none).toEqual([]);
    expect(side(none)).toBe("left");
    // No viewed scene or an unknown attacker: none either.
    expect(ids("Goblin", [], null)).toEqual([]);
    expect(ids("Nobody")).toEqual([]);
  });

  test("FR-CBT-56 likely targets: rows win over likely targets", () => {
    expect(ids("Goblin", ["t-gob2"])).toEqual(["t-gob2"]);
    expect(side(ids("Goblin", ["t-gob2"]))).toBe("left");
  });
});

describe("FR-CBT-75 FR-CBT-76 popup over its notification, movable", () => {
  const vp = { w: 1440, h: 900 };
  const size = { w: 440, h: 300 };

  test("FR-CBT-75 placement: origin rect → top-left, clamped into the work area", () => {
    expect(originPlacement({ x: 560, y: 92 }, size, vp)).toEqual({ x: 560, y: 92, ...size });
    // Off the right / bottom edge → moved in (bottom = above the launcher).
    expect(originPlacement({ x: 1300, y: 800 }, size, vp)).toEqual({
      x: 1440 - 440,
      y: 900 - 64 - 300,
      ...size,
    });
    // Above the top bar / left of the viewport → moved in.
    expect(originPlacement({ x: -20, y: 10 }, size, vp)).toMatchObject({ x: 0, y: 48 });
    // Taller than the work area: the top stays inside.
    expect(clampIntoWorkArea({ x: 0, y: 500, w: 440, h: 2000 }, vp).y).toBe(48);
  });

  test("FR-CBT-76 drag: follows the pointer, stops at the work-area edge", () => {
    const start = { x: 100, y: 200, ...size };
    expect(dragPopup(start, 300, 50, vp)).toEqual({ x: 400, y: 250, ...size });
    expect(dragPopup(start, 5000, 5000, vp)).toEqual({ x: 1000, y: 536, ...size });
    expect(dragPopup(start, -5000, -5000, vp)).toEqual({ x: 0, y: 48, ...size });
  });
});

describe("FR-CBT-56 FR-CBT-75 P3 glitch 2: free area away from the likely targets", () => {
  // Session-sim-5 c08: Wolf attacks Goblin 4 (row); the goblins sit mid-map, left of Initiative.
  const initiative = { x: 1028, w: 400 };
  const box = (x: number, y: number) => ({ x, y, w: 50, h: 50 });
  const g4 = box(497, 265);
  const goblins = [box(550, 318), box(708, 265), box(708, 370), box(866, 370)];
  const pcs = [box(180, 318), box(180, 423)];
  const covers = (p: { x: number; y?: number }, h: number, t: { x: number; y: number }) =>
    p.x < t.x + 50 && t.x < p.x + 440 && (p.y ?? 0) < t.y + 50 && t.y < (p.y ?? 0) + h;

  test("FR-CBT-56 tiers: rows, then the other likely targets, then every other combatant token", () => {
    const k = (id: string, kind: "pc" | "monster", tokenId: string) => ({
      id,
      encounterId: "e1",
      kind,
      tokenId,
      name: id,
      active: true,
      removed: false,
    });
    const combatants = [
      k("Wolf", "monster", "t-wolf"),
      k("Goblin", "monster", "t-gob"),
      k("Goblin 4", "monster", "t-g4"),
      k("Mira", "pc", "t-mira"),
      k("Thorn", "pc", "t-thorn"),
    ];
    const tiers = (rowTokenIds: string[]) =>
      placementTiers({
        rowTokenIds,
        combatants,
        encounterId: "e1",
        attackerId: "Wolf",
        tokenSceneOf: () => "s1",
        viewedSceneId: "s1",
      });
    expect(tiers(["t-g4"])).toEqual([["t-g4"], ["t-mira", "t-thorn"], ["t-wolf", "t-gob"]]);
    expect(tiers([])).toEqual([["t-mira", "t-thorn"], [], ["t-wolf", "t-gob", "t-g4"]]);
  });

  test("FR-CBT-56 with a measured height: clear of the row's token first, then of the others", () => {
    const h = 305;
    const p = popupPlacement({
      viewport: { w: 1440, h: 900 },
      tokens: [g4],
      others: [pcs, goblins],
      initiative,
      width: 440,
      height: h,
    });
    expect(p.y).toBeDefined();
    for (const t of [g4, ...pcs, ...goblins]) expect(covers(p, h, t)).toBe(false);
    expect(p.x + 440).toBeLessThanOrEqual(initiative.x);
  });

  test("FR-CBT-56 no measured height: full height, no y; a lower tier only breaks ties", () => {
    const p = popupPlacement({ ...base, tokens: at([1000, 1100]), others: [at([700])] });
    expect(p).toMatchObject({ side: "left", x: 68 });
    expect(p.y).toBeUndefined();
    // The left edge would cover a lower-tier token: another spot clear of both tiers wins.
    const q = popupPlacement({ ...base, tokens: at([1000, 1100]), others: [at([200])] });
    expect(at([1000, 1100, 200]).some((t) => q.x < t.x + t.w && t.x < q.x + 440)).toBe(false);
  });

  test("FR-CBT-75 over its notification unless that covers a likely target", () => {
    const vp = { w: 1440, h: 900 };
    const clearSpot = { x: 68, y: 100 };
    const p = popupPlacement({
      viewport: vp,
      tokens: goblins,
      others: [[], pcs],
      initiative,
      width: 440,
      height: 300,
      prefer: clearSpot,
    });
    expect(p).toMatchObject({ side: "origin", x: 68, y: 100 });
    // The toast sat over the goblins (d02): the popup moves off them.
    const over = popupPlacement({
      viewport: vp,
      tokens: goblins,
      initiative,
      width: 440,
      height: 300,
      prefer: { x: 560, y: 100 },
    });
    expect(over.side).not.toBe("origin");
    for (const t of goblins) expect(covers(over, 300, t)).toBe(false);
  });

  test("FR-CBT-75 origin covers a likely target → the nearest free spot, not the far side (sim-6 d02)", () => {
    // Mira's card: the toast sat top-left (68, 100), clear of the monsters; the 440 px popup there
    // clips hidden Goblin 4. It opened bottom centre (577, 577); it now drops just below Goblin 4.
    const monsters = [g4, ...goblins, box(815, 160)];
    for (const init of [initiative, null]) {
      const p = popupPlacement({
        viewport: { w: 1440, h: 900 },
        tokens: monsters,
        others: [[], pcs],
        initiative: init,
        width: 440,
        height: 258,
        prefer: { x: 68, y: 100 },
      });
      expect(p).toMatchObject({ side: "left", x: 68, y: 319 });
      for (const t of monsters) expect(covers(p, 258, t)).toBe(false);
    }
  });

  test("FR-CBT-75 no spot clear of the likely targets → the usual pick", () => {
    // A wall of targets across the whole work area: nothing is free, so tiers decide.
    const wall = Array.from({ length: 30 }, (_, k) =>
      box(68 + (k % 6) * 230, 60 + Math.floor(k / 6) * 160),
    );
    const p = popupPlacement({
      viewport: { w: 1440, h: 900 },
      tokens: wall,
      initiative: null,
      width: 440,
      height: 300,
      prefer: { x: 68, y: 100 },
    });
    expect(p.side).not.toBe("origin");
    const area = (q: { x: number; y?: number }) =>
      coveredArea({ x: q.x, y: q.y ?? 0, w: 440, h: 300 }, wall);
    expect(area(p)).toBeLessThan(area({ x: 68, y: 100 }));
  });
});
