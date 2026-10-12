import { describe, expect, test } from "bun:test";
import type { SceneFolderRecord, SceneRecord } from "@shared/scenes-map/schemas";
import { viewedScene } from "./view-state";

const s = (id: string, name: string, seq: number, active = false, folderId: string | null = null) =>
  ({ id, name, seq, active, folderId }) as SceneRecord;
const folders = [{ id: "f", name: "Act 1", seq: 1 } as SceneFolderRecord];

describe("FR-MAP-08 viewed scene", () => {
  test("requested if it exists, else active, else first in list order, else none", () => {
    const town = s("town", "Town", 1, true, "f");
    const ambush = s("ambush", "Goblin Ambush", 2, false, "f");
    const cellar = s("cellar", "Cellar", 3);
    const all = [town, ambush, cellar];
    expect(viewedScene(all, folders, "cellar")?.id).toBe("cellar");
    expect(viewedScene(all, folders, null)?.id).toBe("town");
    // Requested scene deleted (another DM tab) → default.
    expect(viewedScene(all, folders, "gone")?.id).toBe("town");
    // None active → first in list order: folder Act 1 first, then by name.
    expect(viewedScene([{ ...town, active: false }, ambush, cellar], folders, null)?.id).toBe(
      "ambush",
    );
    expect(viewedScene([], folders, "x")).toBeNull();
  });
});
