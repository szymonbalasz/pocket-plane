// FR-OVW-13: the overview's tool set and the signals it reuses.
import { describe, expect, mock, test } from "bun:test";
import { MAP_SIGNALS } from "@shared/scenes-map/schemas";
import {
  activeOverviewTool,
  type OverviewPointer,
  orderOverviewTools,
  overviewToolsFor,
  pingTool,
  SELECT_TOOL_ID,
} from "./overview-tools";

const pointer = (over: Partial<OverviewPointer>): OverviewPointer => ({
  x: 10,
  y: 20,
  screen: { x: 0, y: 0 },
  button: 0,
  ctrl: false,
  shift: false,
  alt: false,
  clicks: 1,
  client: "dm",
  overviewId: "ovw-1",
  myPlayerId: null,
  item: null,
  live: true,
  signalsLive: true,
  scale: 1,
  intent: () => Promise.resolve(),
  signal: () => {},
  markPing: () => {},
  holdPan: () => {},
  ...over,
});

describe("FR-OVW-13 tools", () => {
  test("FR-OVW-13 no grid, ruler, walls, fog or templates on either client", () => {
    for (const client of ["dm", "player"] as const) {
      const ids = overviewToolsFor(client).map((t) => t.id);
      expect(ids).toContain("select");
      expect(ids).toContain("ping");
      for (const battle of ["ruler", "grid", "structure", "fog", "aoe"]) {
        expect(ids).not.toContain(battle);
      }
    }
  });

  test("FR-OVW-13 Select and Add image on the DM's rail; a player gets no Add image", () => {
    expect(overviewToolsFor("dm").map((t) => t.id)).toEqual([
      "select",
      "add-image",
      "add-party",
      "add-miniature",
      "ping",
    ]);
    expect(overviewToolsFor("player").map((t) => t.id)).toEqual(["select", "ping"]);
    expect(activeOverviewTool("add-image", "dm").edits).toBe(true);
    // A player has no such tool: back to Select.
    expect(activeOverviewTool("add-image", "player").id).toBe(SELECT_TOOL_ID);
  });

  test("FR-OVW-11 Select pans with a left-drag; Ping doesn't", () => {
    expect(activeOverviewTool(SELECT_TOOL_ID, "dm").pans).toBe(true);
    expect(activeOverviewTool("ping", "dm").pans).toBeUndefined();
    // A battle tool still in the map's store means nothing here: Select.
    expect(activeOverviewTool("fog", "dm").id).toBe(SELECT_TOOL_ID);
  });

  test("FR-OVW-13 ping carries the overview's ID as sceneId; Shift pulls, DM only", () => {
    const signal = mock();
    const markPing = mock();
    pingTool.pointer?.down?.(pointer({ signal, markPing }));
    expect(signal).toHaveBeenLastCalledWith(MAP_SIGNALS.ping, {
      sceneId: "ovw-1",
      x: 10,
      y: 20,
    });
    expect(markPing).toHaveBeenCalledWith(10, 20);
    pingTool.pointer?.down?.(pointer({ signal, markPing, shift: true }));
    expect(signal.mock.lastCall?.[0]).toBe(MAP_SIGNALS.pull);
    pingTool.pointer?.down?.(pointer({ signal, markPing, shift: true, client: "player" }));
    expect(signal.mock.lastCall?.[0]).toBe(MAP_SIGNALS.ping);
  });

  test("FR-OVW-10 ping off while players don't see the overview (or not live)", () => {
    const signal = mock();
    pingTool.pointer?.down?.(pointer({ signal, signalsLive: false }));
    expect(signal).not.toHaveBeenCalled();
    expect(pingTool.signal).toBe(true);
  });

  test("a tool registered twice, or an order used twice, throws at load", () => {
    const t = { label: "T", icon: () => null, clients: ["dm"] as const };
    expect(() =>
      orderOverviewTools([
        { ...t, id: "a", order: 1 },
        { ...t, id: "a", order: 2 },
      ]),
    ).toThrow();
    expect(() =>
      orderOverviewTools([
        { ...t, id: "a", order: 1 },
        { ...t, id: "b", order: 1 },
      ]),
    ).toThrow();
  });
});
