// FR-MAP-121: Teleport's cell pick (start, target rules, press, Esc, back to the previous tool, off
// the rail); FR-MAP-122: the poof look (fixed spot, both ends, Off, bound, end).
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { MAP_INTENTS, type SceneView } from "@shared/scenes-map/schemas";
import { FxEngine } from "../spell-fx/engine";
import { POOF } from "../spell-fx/looks";
import { recordingCtx } from "../spell-fx/test-ctx";
import { canvasTools } from "./canvas-tools";
import {
  endTeleport,
  startTeleport,
  TELEPORT_TOOL_ID,
  teleportTarget,
  teleportTool,
  useTeleportPick,
} from "./teleport-tool";
import { useMapTool } from "./tool-store";
import { activeTool, escapeOrder, isDrawing, type ToolPointer, toolsFor } from "./tools";

const grid = { gridCellSize: 50, gridOffsetX: 0, gridOffsetY: 0 };
const scene = { mapWidth: 500, mapHeight: 500 } as SceneView;
const goblin = { id: "g1", name: "Goblin", size: "medium", col: 2, row: 2 } as const;
const at = (col: number, row: number) => ({ cell: { col, row }, scene, grid });

function pointer(col: number, row: number, intent = () => Promise.resolve({})) {
  return { ...at(col, row), intent } as unknown as ToolPointer;
}

beforeEach(() => {
  useTeleportPick.setState({ token: null, returnTo: "select", hover: null });
  useMapTool.setState({ tool: "select" });
});

describe("Teleport's cell pick (FR-MAP-121)", () => {
  test("FR-MAP-121 starting from the menu picks the tool and remembers the previous one", () => {
    useMapTool.setState({ tool: "ruler" });
    startTeleport(goblin);
    expect(useMapTool.getState().tool).toBe(TELEPORT_TOOL_ID);
    expect(useTeleportPick.getState().token?.id).toBe("g1");
    expect(useTeleportPick.getState().returnTo).toBe("ruler");
  });

  test("FR-MAP-121 a second token while picking keeps the tool to go back to", () => {
    useMapTool.setState({ tool: "ruler" });
    startTeleport(goblin);
    startTeleport({ ...goblin, id: "g2" });
    expect(useTeleportPick.getState().token?.id).toBe("g2");
    expect(useTeleportPick.getState().returnTo).toBe("ruler");
  });

  test("FR-MAP-121 DM only, no rail button, and a drawing tool (tokens ignore left press)", () => {
    expect(activeTool(canvasTools, TELEPORT_TOOL_ID, "dm")?.id).toBe(TELEPORT_TOOL_ID);
    expect(activeTool(canvasTools, TELEPORT_TOOL_ID, "player")).toBeNull();
    expect(toolsFor(canvasTools, "dm").map((t) => t.id)).not.toContain(TELEPORT_TOOL_ID);
    expect(isDrawing(teleportTool)).toBe(true);
  });

  test("FR-MAP-121 any other cell on the map; not its own cell, not off the map", () => {
    expect(teleportTarget(goblin, at(7, 3))).toEqual({ col: 7, row: 3 });
    expect(teleportTarget(goblin, at(2, 2))).toBeNull();
    expect(teleportTarget(goblin, at(10, 3))).toBeNull();
    expect(teleportTarget(goblin, at(-1, 3))).toBeNull();
  });

  test("FR-MAP-121 a press sends one teleport and goes back to the previous tool", async () => {
    useMapTool.setState({ tool: "ruler" });
    startTeleport(goblin);
    const sent: unknown[] = [];
    const intent = (name: string, input: unknown) => {
      sent.push([name, input]);
      return Promise.resolve({});
    };
    teleportTool.pointer?.down?.(pointer(7, 3, intent as never));
    expect(sent).toEqual([[MAP_INTENTS.teleportToken, { tokenId: "g1", col: 7, row: 3 }]]);
    expect(useMapTool.getState().tool).toBe("ruler");
    expect(useTeleportPick.getState().token).toBeNull();
  });

  test("FR-MAP-121 a press on its own cell or off the map sends nothing and keeps picking", () => {
    startTeleport(goblin);
    const intent = spyOn({ f: () => Promise.resolve({}) }, "f");
    teleportTool.pointer?.down?.(pointer(2, 2, intent as never));
    teleportTool.pointer?.down?.(pointer(99, 2, intent as never));
    expect(intent).not.toHaveBeenCalled();
    expect(useMapTool.getState().tool).toBe(TELEPORT_TOOL_ID);
  });

  test("FR-MAP-121 hovering shows the target; its own cell clears it", () => {
    startTeleport(goblin);
    teleportTool.pointer?.move?.(pointer(5, 5));
    expect(useTeleportPick.getState().hover).toEqual({ col: 5, row: 5 });
    teleportTool.pointer?.move?.(pointer(2, 2));
    expect(useTeleportPick.getState().hover).toBeNull();
  });

  test("FR-MAP-121 Esc ends the pick there (the selection stays) and restores the tool", () => {
    useMapTool.setState({ tool: "ruler" });
    startTeleport(goblin);
    expect(escapeOrder(false, false, teleportTool)).toBe("tool");
    expect(teleportTool.pointer?.cancel?.("escape")).toBe(true);
    expect(useMapTool.getState().tool).toBe("ruler");
    // Nothing left to drop: the next Esc goes on to the DM's selection handler.
    useMapTool.setState({ tool: TELEPORT_TOOL_ID });
    expect(teleportTool.pointer?.cancel?.("escape")).toBe(false);
  });

  test("FR-MAP-121 picking another tool drops the pick and keeps that tool", () => {
    startTeleport(goblin);
    useMapTool.setState({ tool: "ping" });
    teleportTool.pointer?.cancel?.("tool");
    expect(useTeleportPick.getState().token).toBeNull();
    expect(useMapTool.getState().tool).toBe("ping");
  });

  test("FR-MAP-121 a scene switch or leaving live ends the pick", () => {
    for (const reason of ["scene", "live"] as const) {
      startTeleport(goblin);
      teleportTool.pointer?.cancel?.(reason);
      expect(useMapTool.getState().tool).toBe("select");
      expect(useTeleportPick.getState().token).toBeNull();
    }
    endTeleport();
    expect(useMapTool.getState().tool).toBe("select");
  });
});

describe("the poof look (FR-MAP-122)", () => {
  const box = (x: number, y: number) => ({ x, y, size: 50 });

  function engine() {
    let now = 100;
    const e = new FxEngine(() => now);
    e.setView({ cell: 50, position: () => null });
    return { e, tick: (s: number) => (now += s) };
  }

  test("FR-MAP-122 one puff per end, at its own spot, with no token drawn there", () => {
    const { e } = engine();
    expect(e.playPoof("cue-1", [box(0, 0), box(400, 200)])).toBe(true);
    const looks = e.snapshot().looks;
    expect(looks.map((l) => l.at)).toEqual([box(0, 0), box(400, 200)]);
    expect(new Set(looks.map((l) => l.key)).size).toBe(2);
    expect(e.animating()).toBe(true);
    expect(e.lastPoof).toBe("cue-1");
  });

  test("FR-MAP-122 Off plays nothing", () => {
    const { e } = engine();
    e.setLevel("off");
    expect(e.playPoof("cue-1", [box(0, 0)])).toBe(false);
    expect(e.snapshot().looks).toEqual([]);
  });

  test("FR-MAP-122 stays inside FR-VFX-18's bound and its duration, then ends", () => {
    const { e, tick } = engine();
    e.playPoof("cue-1", [box(100, 100)]);
    expect(POOF.duration).toBeGreaterThanOrEqual(0.4);
    expect(POOF.duration).toBeLessThanOrEqual(1.4);
    for (const t of [0.05, 0.3, 0.3, 0.2]) {
      tick(t);
      e.step();
      const rec = recordingCtx();
      e.drawOver(rec.ctx);
      expect(rec.reach(125, 125)).toBeLessThanOrEqual(50 * 0.8);
    }
    tick(0.2);
    e.step();
    expect(e.snapshot().looks).toEqual([]);
    expect(e.animating()).toBe(false);
  });

  test("FR-MAP-122 same puffs on every frame and every client (seeded by the cue)", () => {
    const draw = () => {
      const { e, tick } = engine();
      e.playPoof("cue-1", [box(0, 0)]);
      tick(0.3);
      e.step();
      const rec = recordingCtx();
      e.drawOver(rec.ctx);
      return rec.calls.join();
    };
    expect(draw()).toBe(draw());
  });
});
