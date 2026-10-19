import { afterEach, describe, expect, test } from "bun:test";
import type { RecordStore } from "@shared/protocol/store";
import { AOE_TEMPLATE_TYPE, type TemplateRecordView } from "@shared/scene-tools/schemas";
import type { LayerMenuContext } from "../scenes-map/layers";
import { useMapTool } from "../scenes-map/tool-store";
import {
  closeTemplateMenu,
  editFromMenu,
  templateContextMenu,
  useAoe,
  useTemplateMenu,
} from "./aoe-store";
import {
  type TemplateHitOptions,
  templateAt,
  templateMenuItems,
  templateMenuStays,
} from "./templates";

const GRID = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };

const rec = (id: string, t: Partial<TemplateRecordView>): TemplateRecordView => ({
  id,
  sceneId: "s1",
  shape: "sphere",
  x: 0,
  y: 0,
  size: 10,
  width: null,
  angle: 0,
  label: id,
  placedByPlayerId: null,
  hidden: false,
  ...t,
});

// Draw order: later = on top.
const sphere = rec("sphere", { x: 5, y: 5, size: 10, placedByPlayerId: "p1" }); // r 140 px at (350, 350)
const cube = rec("cube", { shape: "cube", x: 4, y: 4, size: 20, placedByPlayerId: "p2" }); // 280..560
const cone = rec("cone", { shape: "cone", x: 10, y: 2, size: 30 }); // (700, 140) east, 420 px long
const line = rec("line", { shape: "line", x: 2, y: 12, size: 30, width: 5 }); // y 840 ± 35
const glyph = rec("glyph", { shape: "cube", x: 14, y: 10, size: 10, hidden: true }); // 980..1120
const edge = rec("edge", { shape: "cylinder", x: 0, y: 0, size: 10 }); // off the map's edge
const all = [sphere, cube, cone, line, glyph, edge];

const dm: TemplateHitOptions = {
  client: "dm",
  myPlayerId: null,
  dmOnlyOff: false,
  templatesOff: false,
  blind: false,
  scale: 1,
  grid: GRID,
};
const p1: TemplateHitOptions = { ...dm, client: "player", myPlayerId: "p1" };
const p2: TemplateHitOptions = { ...dm, client: "player", myPlayerId: "p2" };
const at = (x: number, y: number) => ({ x, y });
const idAt = (x: number, y: number, o: TemplateHitOptions) => templateAt(at(x, y), all, o)?.id;

describe("FR-SCN-49 templateAt", () => {
  test("FR-SCN-49 templateAt inside each shape's true outline", () => {
    expect(idAt(350, 220, dm)).toBe("sphere"); // above the cube
    expect(idAt(900, 140, dm)).toBe("cone");
    expect(idAt(300, 840, dm)).toBe("line");
    expect(idAt(1050, 770, dm)).toBe("glyph");
    expect(idAt(-30, -30, dm)).toBe("edge"); // uncut: off the map still hits
  });

  test("FR-SCN-49 templateAt within 6 screen px of the outline; outside → null", () => {
    // The sphere's top rim at y = 210 (centre 350, r 140), clear of the cube (y 280..560).
    expect(idAt(350, 350 - 140 - 5, dm)).toBe("sphere");
    expect(idAt(350, 350 - 140 - 7, dm)).toBeUndefined();
    // Scale 2: 6 screen px = 3 map px.
    expect(idAt(350, 350 - 140 - 2.5, { ...dm, scale: 2 })).toBe("sphere");
    expect(idAt(350, 350 - 140 - 4, { ...dm, scale: 2 })).toBeUndefined();
    // A line's long side, 5 px out.
    expect(idAt(300, 840 + 35 + 5, dm)).toBe("line");
    expect(idAt(300, 840 + 35 + 8, dm)).toBeUndefined();
    expect(idAt(1500, 1500, dm)).toBeUndefined();
  });

  test("FR-SCN-49 topmost editable wins; a player's own under another's is found; another player's → null", () => {
    // (350, 350): inside the sphere (p1) and the cube (p2) above it.
    expect(idAt(350, 350, dm)).toBe("cube");
    expect(idAt(350, 350, p1)).toBe("sphere");
    expect(idAt(350, 350, p2)).toBe("cube");
    // (525, 525): the cube only.
    expect(idAt(525, 525, p1)).toBeUndefined();
    // DM templates are never a player's.
    expect(idAt(900, 140, p1)).toBeUndefined();
  });

  test("FR-SCN-49 hidden: DM with DM-only items on only; templatesOff → null; blind player → own kept only", () => {
    expect(idAt(1050, 770, dm)).toBe("glyph");
    expect(idAt(1050, 770, { ...dm, dmOnlyOff: true })).toBeUndefined();
    const ownHidden = [rec("mine", { hidden: true, placedByPlayerId: "p1", x: 5, y: 5 })];
    expect(templateAt(at(350, 350), ownHidden, p1)).toBeNull();
    const off = { ...dm, templatesOff: true };
    for (const [x, y] of [
      [350, 350],
      [900, 140],
      [1050, 770],
    ] as const)
      expect(idAt(x, y, off)).toBeUndefined();
    expect(idAt(350, 350, { ...p1, blind: true })).toBe("sphere");
    expect(idAt(350, 350, { ...p2, blind: true })).toBe("cube");
    expect(idAt(350, 350, { ...p1, blind: true, myPlayerId: null })).toBeUndefined();
  });
});

describe("FR-SCN-48 template menu", () => {
  afterEach(() => {
    closeTemplateMenu();
    useMapTool.setState({ tool: "select" });
    useAoe.setState({ selectedId: null, editable: [], sceneId: null });
  });

  const web = rec("web", { label: "Web", shape: "cube" });
  const glyphRec = rec("glyph", { label: "Glyph", shape: "cube", hidden: true });
  const guardians = rec("guardians", { label: "Spirit Guardians", placedByPlayerId: "p1" });
  const thunderwave = rec("thunderwave", { label: "Thunderwave", placedByPlayerId: "p2" });
  const view = (items: ReturnType<typeof templateMenuItems>) =>
    items.map((i) => `${i.label}${i.disabled ? " (disabled)" : ""}`);

  test("FR-SCN-48 template menu items per role (DM on Web, Glyph; player-1 on Spirit Guardians, Thunderwave)", () => {
    expect(view(templateMenuItems(web, "dm", null, true))).toEqual(["Delete", "Edit…", "Hide"]);
    expect(view(templateMenuItems(glyphRec, "dm", null, true))).toEqual([
      "Delete",
      "Edit…",
      "Reveal",
    ]);
    expect(view(templateMenuItems(guardians, "player", "p1", true))).toEqual(["Delete", "Edit…"]);
    expect(templateMenuItems(thunderwave, "player", "p1", true)).toEqual([]);
    expect(templateMenuItems(web, "player", "p1", true)).toEqual([]);
  });

  test("FR-SCN-48 template menu items disabled while not live (FR-SCN-50)", () => {
    expect(view(templateMenuItems(web, "dm", null, false))).toEqual([
      "Delete (disabled)",
      "Edit… (disabled)",
      "Hide (disabled)",
    ]);
  });

  test("FR-SCN-48 template menu Edit… activates the AoE tool with the template selected", () => {
    useTemplateMenu.setState({ open: { templateId: "web", sceneId: "s1", at: { x: 1, y: 2 } } });
    editFromMenu("web");
    expect(useMapTool.getState().tool).toBe("aoe");
    expect(useAoe.getState().selectedId).toBe("web");
    expect(useTemplateMenu.getState().open).toBeNull();
  });

  test("FR-SCN-48 template menu opens at the pointer on the hit template (layer contextMenu)", () => {
    const store = {
      records: { [AOE_TEMPLATE_TYPE]: Object.fromEntries(all.map((t) => [t.id, t])) },
    } as unknown as RecordStore;
    const ctx = {
      client: "player",
      myPlayerId: "p1",
      scene: { id: "s1" },
      store,
      cam: { x: 0, y: 0, scale: 1 },
      grid: GRID,
      off: {},
    } as unknown as LayerMenuContext;
    expect(templateContextMenu.hit(at(350, 350), ctx)).toBe(true);
    expect(templateContextMenu.hit(at(525, 525), ctx)).toBe(false);
    templateContextMenu.open(at(350, 350), at(400, 300), ctx);
    expect(useTemplateMenu.getState().open).toEqual({
      templateId: "sphere",
      sceneId: "s1",
      at: { x: 400, y: 300 },
    });
    // DM: the Templates switch off → no hit; DM-only items off → no hidden hit.
    const dmCtx = { ...ctx, client: "dm", myPlayerId: null } as LayerMenuContext;
    expect(templateContextMenu.hit(at(1050, 770), dmCtx)).toBe(true);
    expect(templateContextMenu.hit(at(1050, 770), { ...dmCtx, off: { "dm-only": true } })).toBe(
      false,
    );
    expect(templateContextMenu.hit(at(900, 140), { ...dmCtx, off: { templates: true } })).toBe(
      false,
    );
    // Another scene's templates never hit.
    expect(
      templateContextMenu.hit(at(350, 350), { ...ctx, scene: { id: "s2" } } as LayerMenuContext),
    ).toBe(false);
  });

  test("FR-SCN-50 an open menu closes when its template leaves what this client may edit", () => {
    const open = { templateId: "web", sceneId: "s1" };
    expect(templateMenuStays(open, [web], "s1")).toBe(true);
    expect(templateMenuStays(open, [], "s1")).toBe(false); // deleted / cleared / hidden for me
    expect(templateMenuStays(open, [web], "s2")).toBe(false); // scene switch
    expect(templateMenuStays(null, [web], "s1")).toBe(false);
  });
});
