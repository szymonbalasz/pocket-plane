// FR-VFX-40 (client, pure): template anchors (which kept templates draw, the aura on its
// template, the square's box), the grab reaction for anyone in the square, the Black Tentacles
// renderer (bounds, Still determinism), and the AoE tool's placement request.
import { afterEach, describe, expect, test } from "bun:test";
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { applySnapshot, type RecordStore } from "@shared/protocol/store";
import { AOE_TEMPLATE_TYPE, type TemplateRecordView } from "@shared/scene-tools/schemas";
import type { TokenView } from "@shared/scenes-map/schemas";
import { presetOf } from "@shared/spell-fx/presets";
import {
  cancelAoe,
  endRequest,
  requestPlacement,
  sendRequest,
  showOwn,
  useAoe,
} from "../scene-tools/aoe-store";
import { DEFAULT_AOE } from "../scene-tools/templates";
import { useMapTool } from "../scenes-map/tool-store";
import { aurasOf, drawnTemplates, insideSquare, templateAnchorId, templateBox } from "./anchors";
import { type AuraFrame, STILL_T } from "./aura-types";
import { FxEngine, type FxView } from "./engine";
import { turnStrikes } from "./reactions";
import { rendererOf } from "./renderers";
import { recordingCtx } from "./test-ctx";

const CELL = 50;
const GRID = { gridCellSize: CELL, gridOffsetX: 0, gridOffsetY: 0 };

const tpl = (over: Partial<TemplateRecordView> & { id: string }): TemplateRecordView => ({
  sceneId: "s1",
  shape: "cube",
  x: 4,
  y: 3,
  size: 20,
  width: null,
  angle: 0,
  label: "Evard's Black Tentacles",
  placedByPlayerId: "p2",
  hidden: false,
  ...over,
});

const effect = (over: Record<string, unknown>) => ({
  campaignId: "c1",
  seq: 1,
  kind: "concentration",
  label: "Evard's Black Tentacles",
  condition: null,
  level: null,
  targetCombatantId: null,
  targetCharacterId: "thorn",
  endedAt: null,
  fx: { preset: "black-tentacles", params: {}, spellId: "sp", templateId: "tp1" },
  ...over,
});

function storeOf(
  role: "dm" | "player",
  templates: TemplateRecordView[],
  effects = [effect({ id: "e1" })],
): RecordStore {
  return applySnapshot({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" },
    records: { [EFFECT_TYPE]: effects, [AOE_TEMPLATE_TYPE]: templates },
  } as never);
}

const view = (client: "dm" | "player", over: Record<string, unknown> = {}) => ({
  client,
  myPlayerId: client === "dm" ? null : "p1",
  sceneId: "s1",
  templatesOff: false,
  dmOnlyOff: false,
  blind: false,
  ...over,
});

describe("FR-VFX-40 template anchors", () => {
  test("FR-VFX-40 drawnTemplates: shown scene; DM switches; hidden DM only; blind → own only", () => {
    const all = [
      tpl({ id: "a" }),
      tpl({ id: "b", sceneId: "s2" }),
      tpl({ id: "c", hidden: true, placedByPlayerId: null }),
      tpl({ id: "d", placedByPlayerId: "p1" }),
    ];
    const ids = (role: "dm" | "player", over = {}) =>
      drawnTemplates(storeOf(role, all), view(role, over)).map((t) => t.id);
    expect(ids("dm")).toEqual(["a", "c", "d"]);
    expect(ids("dm", { dmOnlyOff: true })).toEqual(["a", "d"]);
    expect(ids("dm", { templatesOff: true })).toEqual([]);
    expect(ids("player")).toEqual(["a", "d"]);
    expect(ids("player", { blind: true })).toEqual(["d"]);
  });

  test("FR-VFX-40 aurasOf: on the effect's template (anchor tpl:<id>), none without it", () => {
    const t = tpl({ id: "tp1" });
    const store = storeOf("player", [t]);
    const [spec, ...rest] = aurasOf(store, [], { client: "player", myPlayerId: "p1" }, [t]);
    expect(rest).toEqual([]);
    expect(spec).toMatchObject({
      key: `e1:${templateAnchorId("tp1")}`,
      tokenId: "tpl:tp1",
      templateId: "tp1",
      radiusFt: null,
      hidden: false,
    });
    // Not drawn here (fogged / hidden / other scene / deleted) → nothing.
    expect(aurasOf(store, [], { client: "player", myPlayerId: "p1" }, [])).toEqual([]);
    // No templateId (an old or hand-set effect) → nothing.
    const bare = storeOf(
      "dm",
      [t],
      [effect({ id: "e2", fx: { preset: "black-tentacles", params: {} } })],
    );
    expect(aurasOf(bare, [], { client: "dm", myPlayerId: null }, [t])).toEqual([]);
    // DM: a hidden template's aura is drawn at the hidden opacity.
    const h = tpl({ id: "tp1", hidden: true });
    expect(
      aurasOf(storeOf("dm", [h]), [], { client: "dm", myPlayerId: null }, [h])[0]?.hidden,
    ).toBe(true);
  });

  test("FR-VFX-40 templateBox: the cube's square about its centre, rotated by its angle", () => {
    // Corner (4, 3), 20 ft = 4 cells along 0° and 90°: centre (6, 5) cells.
    expect(templateBox(GRID, tpl({ id: "a" }))).toEqual({ x: 200, y: 150, size: 200, angle: 0 });
    // 90°: sides along +y and −x: centre (2, 5).
    const b = templateBox(GRID, tpl({ id: "a", angle: 90 }));
    expect(b.x + b.size / 2).toBeCloseTo(100);
    expect(b.y + b.size / 2).toBeCloseTo(250);
    expect(b.angle).toBeCloseTo(Math.PI / 2);
  });

  test("FR-VFX-40 grab: anyone whose footprint is in the square, either side; outside → none", () => {
    const square = templateBox(GRID, tpl({ id: "tp1" }));
    const at = (col: number, row: number) => ({ x: col * CELL, y: row * CELL, size: CELL });
    expect(insideSquare(square, at(4, 3), CELL)).toBe(true);
    expect(insideSquare(square, at(7, 6), CELL)).toBe(true);
    expect(insideSquare(square, at(8, 3), CELL)).toBe(false);
    expect(insideSquare(square, at(3, 3), CELL)).toBe(false);
    const t = tpl({ id: "tp1" });
    const [spec] = aurasOf(storeOf("dm", [t]), [], { client: "dm", myPlayerId: null }, [t]);
    if (!spec) throw new Error("no spec");
    const tok = (id: string, ownerPlayerId: string | null) =>
      ({ id, ownerPlayerId, characterId: null }) as unknown as TokenView;
    const position = (id: string) =>
      id === spec.tokenId ? square : id === "in" || id === "ally" ? at(5, 4) : at(12, 12);
    const strikes = (id: string, kind: "monster" | "pc", owner: string | null) =>
      turnStrikes(
        [spec],
        { id: `c-${id}`, kind } as CombatantView,
        tok(id, owner),
        position,
        CELL,
      ).map((s) => s.tokenId);
    expect(strikes("in", "monster", null)).toEqual(["in"]);
    expect(strikes("ally", "pc", "p2")).toEqual(["ally"]);
    expect(strikes("out", "monster", null)).toEqual([]);
  });
});

describe("FR-VFX-40 Black Tentacles renderer", () => {
  const renderer = rendererOf("black-tentacles");
  const frame = (over: Partial<AuraFrame> = {}): AuraFrame => ({
    x: 500,
    y: 500,
    size: 200,
    cell: CELL,
    radius: 100,
    t: 3.3,
    level: "full",
    alpha: 1,
    cover: "half",
    ...over,
  });

  test("FR-VFX-40 draws in and about its square (tips may lap a cell over), rotated with it", () => {
    if (!renderer) throw new Error("no renderer");
    const inst = renderer.create("e1", presetOf("black-tentacles")?.params.parse({}) ?? {});
    for (const angle of [0, 0.7]) {
      for (let t = 0; t < 8; t += 0.5) {
        const rec = recordingCtx(false);
        const f = frame({ t, angle });
        inst.under(rec.ctx, f);
        inst.over(rec.ctx, f, []);
        // Half diagonal of the square + the longest tentacle (1.3 cells) + its width.
        expect(rec.reach(500, 500)).toBeLessThanOrEqual(100 * Math.SQRT2 + CELL * 1.5);
      }
    }
    // A grab draws around its target.
    const rec = recordingCtx(false);
    inst.over(rec.ctx, frame(), [{ kind: "strike", toX: 900, toY: 900, age: 0.6 }]);
    expect(rec.reach(900, 900)).toBeGreaterThan(0);
  });

  test("FR-VFX-14 Still: a pure function of (seed, position); a bigger square draws more tentacles", () => {
    const calls = (seed: string, size = 200) => {
      if (!renderer) throw new Error("no renderer");
      const inst = renderer.create(seed, {});
      const rec = recordingCtx();
      const f = frame({ t: STILL_T, level: "still", size });
      inst.reset(f);
      inst.under(rec.ctx, f);
      return rec.calls;
    };
    expect(calls("e1").join("\n")).toBe(calls("e1").join("\n"));
    expect(calls("e2").join("\n")).not.toBe(calls("e1").join("\n"));
    const fills = (c: string[]) => c.filter((x) => x === "fill()").length;
    expect(fills(calls("e1", 400))).toBeGreaterThan(fills(calls("e1", 200)));
  });

  test("FR-VFX-40 engine: a template anchor's angle reaches the frame", () => {
    const square = templateBox(GRID, tpl({ id: "tp1", angle: 45 }));
    const v: FxView = { cell: CELL, position: (id) => (id === "tpl:tp1" ? square : null) };
    const e = new FxEngine(() => 0);
    e.setView(v);
    e.setLevel("still");
    const t = tpl({ id: "tp1", angle: 45 });
    e.sync(aurasOf(storeOf("dm", [t]), [], { client: "dm", myPlayerId: null }, [t]));
    const turned = recordingCtx();
    e.drawUnder(turned.ctx);
    const flat = recordingCtx();
    const e2 = new FxEngine(() => 0);
    e2.setView({ ...v, position: (id) => (id === "tpl:tp1" ? { ...square, angle: 0 } : null) });
    e2.setLevel("still");
    e2.sync(aurasOf(storeOf("dm", [t]), [], { client: "dm", myPlayerId: null }, [t]));
    e2.drawUnder(flat.ctx);
    expect(turned.calls.length).toBeGreaterThan(0);
    expect(turned.calls.join("\n")).not.toBe(flat.calls.join("\n"));
  });
});

describe("FR-VFX-40 AoE placement request", () => {
  afterEach(() => {
    endRequest(false);
    useAoe.setState({ own: null, settings: DEFAULT_AOE });
    useMapTool.getState().setTool("select");
  });

  const request = (sent: unknown[]) => ({
    key: "vfx.cast:sp",
    title: "Evard's Black Tentacles",
    shape: "cube" as const,
    size: 20,
    place: async (...args: unknown[]) => {
      sent.push(args);
    },
  });

  test("FR-VFX-40 borrows the AoE tool (cube 20 ft, the title as label); the release sends; all restored", async () => {
    const sent: unknown[] = [];
    useMapTool.getState().setTool("select");
    requestPlacement(request(sent));
    expect(useMapTool.getState().tool).toBe("aoe");
    expect(useAoe.getState().settings).toMatchObject({
      shape: "cube",
      size: 20,
      label: "Evard's Black Tentacles",
    });
    showOwn("s1", { shape: "cube", x: 4, y: 3, size: 20, width: null, angle: 90, label: "" });
    await sendRequest();
    expect(sent).toHaveLength(1);
    expect((sent[0] as unknown[])[0]).toBe("s1");
    expect((sent[0] as unknown[])[1]).toMatchObject({ x: 4, y: 3, angle: 90 });
    expect(useAoe.getState().request).toBeNull();
    expect(useAoe.getState().own).toBeNull();
    expect(useAoe.getState().settings).toEqual(DEFAULT_AOE);
    expect(useMapTool.getState().tool).toBe("select");
  });

  test("FR-VFX-40 Esc cancels the request (nothing sent) and gives the tool back", () => {
    const sent: unknown[] = [];
    requestPlacement(request(sent));
    expect(cancelAoe("escape")).toBe(true);
    expect(useAoe.getState().request).toBeNull();
    expect(useMapTool.getState().tool).toBe("select");
    expect(sent).toEqual([]);
  });
});
