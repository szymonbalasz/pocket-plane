import { describe, expect, test } from "bun:test";
import { useMapTool } from "@ui/features/scenes-map/tool-store";
import {
  dispatchSelection,
  getMapSelection,
  setMapSelection,
  setTargeting,
  toggleMapSelection,
} from "./selection";

describe("FR-MAP-33 selection API", () => {
  test("set / toggle edit the viewed scene's selection; a scene change clears it", () => {
    dispatchSelection({ type: "scene", sceneId: "s1" });
    setMapSelection(["a", "b"]);
    toggleMapSelection("b");
    toggleMapSelection("c");
    expect(getMapSelection()).toEqual({ sceneId: "s1", tokenIds: ["a", "c"] });
    dispatchSelection({ type: "scene", sceneId: "s2" });
    expect(getMapSelection()).toEqual({ sceneId: "s2", tokenIds: [] });
  });

  test("targeting forces the Select tool and restores the previous one when off", () => {
    useMapTool.getState().setTool("ruler");
    setTargeting(true);
    expect(useMapTool.getState().tool).toBe("select");
    setTargeting(true);
    setTargeting(false);
    expect(useMapTool.getState().tool).toBe("ruler");
    setTargeting(false);
    expect(useMapTool.getState().tool).toBe("ruler");
  });
});
