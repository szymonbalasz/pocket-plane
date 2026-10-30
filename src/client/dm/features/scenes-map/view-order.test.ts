// FR-OVW-10 DM view order and FR-OVW-43: while an overview is viewed every viewed-scene reader gets
// null, through `useViewedScene`.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { OverviewRecord } from "@shared/overview-scenes/schemas";
import type { SceneFolderRecord, SceneRecord } from "@shared/scenes-map/schemas";
import { startOffHint } from "../combat-tracker/start-reason";
import { viewedOverview, viewedScene } from "./view-state";

const s = (id: string, name: string, seq: number, active = false) =>
  ({ id, name, seq, active, folderId: null }) as SceneRecord;
const o = (id: string, name: string, active = false) =>
  ({ id, name, seq: 1, active, folderId: null }) as OverviewRecord;
const folders: SceneFolderRecord[] = [];

const town = s("town", "Town", 1);
const ambush = s("ambush", "Ambush", 2);
const coast = o("coast", "Sword Coast");
const phandalin = o("phandalin", "Phandalin");

/** What the DM views: the overview's ID, else the scene's, else null (the shell's empty state). */
function viewed(
  scenes: SceneRecord[],
  overviews: OverviewRecord[],
  requested: string | null,
): string | null {
  const overview = viewedOverview(overviews, scenes, requested);
  const scene = viewedScene(scenes, folders, requested, overviews);
  // Never both: while an overview is viewed every viewed-scene reader gets null.
  if (overview) expect(scene).toBeNull();
  return overview?.id ?? scene?.id ?? null;
}

describe("FR-OVW-10 DM view order", () => {
  const liveTown = { ...town, active: true };
  const shown = { ...coast, active: true };

  test("FR-OVW-10 DM view order: a requested overview, even with a scene active", () => {
    expect(viewed([liveTown, ambush], [coast, phandalin], "phandalin")).toBe("phandalin");
    expect(viewed([ambush], [shown, phandalin], "phandalin")).toBe("phandalin");
  });

  test("FR-OVW-10 DM view order: a requested scene, even with an overview shown", () => {
    expect(viewed([town, ambush], [shown], "ambush")).toBe("ambush");
  });

  test("FR-OVW-10 DM view order: then the shown overview", () => {
    expect(viewed([town, ambush], [shown, phandalin], null)).toBe("coast");
    // A stale request (deleted in another tab) falls through.
    expect(viewed([town, ambush], [shown, phandalin], "gone")).toBe("coast");
  });

  test("FR-OVW-10 DM view order: then the active scene, the first scene, the empty state", () => {
    expect(viewed([town, liveTown], [coast], null)).toBe("town");
    expect(viewed([ambush, town], [coast], null)).toBe("ambush");
    expect(viewed([], [coast], null)).toBeNull();
    expect(viewed([], [], "x")).toBeNull();
  });

  test("FR-OVW-10 every reader goes through the seam: viewedScene is called in view-state only", () => {
    const root = join(import.meta.dir, "..", "..", "..");
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          if (/\bviewedScene\(/.test(readFileSync(path, "utf8"))) callers.push(name);
        }
      }
    };
    walk(root);
    expect(callers).toEqual(["view-state.ts"]);
  });
});

describe("FR-OVW-43 start needs a scene", () => {
  const hintFor = (scenes: SceneRecord[], overviews: OverviewRecord[], requested: string | null) =>
    startOffHint(viewedOverview(overviews, scenes, requested) !== null);

  test("FR-OVW-43 start needs a scene: off on an overview, with the hint", () => {
    const shown = { ...coast, active: true };
    expect(hintFor([town], [shown], null)).toBe("Open a battle scene first");
    expect(hintFor([{ ...town, active: true }], [phandalin], "phandalin")).toBe(
      "Open a battle scene first",
    );
  });

  test("FR-OVW-43 start needs a scene: a battle scene opened without showing it starts as today", () => {
    expect(hintFor([town], [{ ...coast, active: true }], "town")).toBeNull();
    expect(hintFor([{ ...town, active: true }], [coast], null)).toBeNull();
  });
});
