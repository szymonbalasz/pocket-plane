// FR-ENT-28: entities' Art line in the DM token menu registry (FR-MAP-29); players get no menu.
import { describe, expect, test } from "bun:test";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { menuFor, tokenMenuEntries } from "../scenes-map/token-menu";
import { entTokenMenu } from "./token-menu-entries";

const token = { id: "t1", hidden: false, characterId: null } as TokenRecord;

describe("FR-ENT-28 Art menu", () => {
  test("FR-ENT-28 Art sits in the DM token menu right after Shape, for every token", () => {
    expect(tokenMenuEntries).toEqual(expect.arrayContaining([...entTokenMenu]));
    const ids = menuFor(token).map((e) => e.id);
    expect(ids.indexOf("ent.art")).toBe(ids.indexOf("map.shape") + 1);
    expect(menuFor({ ...token, characterId: "mira" }).map((e) => e.id)).toContain("ent.art");
  });
});
