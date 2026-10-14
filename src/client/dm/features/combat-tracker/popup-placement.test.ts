import { describe, expect, test } from "bun:test";
import { placementTokenIds, popupPlacement } from "./popup-placement";

const viewport = { w: 1440, h: 900 };
const base = { viewport, initiative: null, width: 440 };

describe("FR-CBT-55 popup placement", () => {
  test("FR-CBT-55 targets right of centre → left edge, clear of the tool rail", () => {
    const p = popupPlacement({ ...base, tokenXs: [1000, 1100] });
    expect(p).toMatchObject({ side: "left", x: 68 });
    // Vertically: the work area below the top bar, above the launcher.
    expect([p.top, p.bottom]).toEqual([60, 836]);
  });

  test("FR-CBT-55 targets left of centre → right edge, just left of an open Initiative window", () => {
    expect(popupPlacement({ ...base, tokenXs: [200, 500] })).toMatchObject({
      side: "right",
      x: 1440 - 12 - 440,
    });
    const initiative = { x: 1028, w: 400 };
    const p = popupPlacement({ ...base, tokenXs: [200], initiative });
    expect(p.side).toBe("right");
    expect(p.x + 440).toBeLessThanOrEqual(initiative.x);
  });

  test("FR-CBT-55 no token → left; the mean decides for spread targets", () => {
    expect(popupPlacement({ ...base, tokenXs: [] }).side).toBe("left");
    expect(popupPlacement({ ...base, tokenXs: [100, 1300, 1350] }).side).toBe("left");
    // Never past the left edge when the Initiative window is wide on a narrow screen.
    const narrow = popupPlacement({
      viewport: { w: 600, h: 700 },
      tokenXs: [100],
      initiative: { x: 300, w: 288 },
      width: 440,
    });
    expect(narrow.x).toBe(68);
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
    popupPlacement({ ...base, tokenXs: tokenIds.map((t) => xs[t] ?? 0) }).side;

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
