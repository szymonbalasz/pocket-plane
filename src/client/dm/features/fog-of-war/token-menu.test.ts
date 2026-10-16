// FR-FOG-47: fog's Invisible line in the DM token menu registry (FR-MAP-29); players get no menu.
import { describe, expect, test } from "bun:test";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { menuFor, tokenMenuEntries } from "../scenes-map/token-menu";
import { fogTokenMenu, INVISIBLE_LABEL } from "./token-menu-entries";

const token = { id: "t1", hidden: false } as TokenRecord;

describe("FR-FOG-47 token menu line", () => {
  test("FR-FOG-47 Invisible sits in the DM token menu after Hide / Reveal, for every token", () => {
    expect(tokenMenuEntries).toEqual(expect.arrayContaining([...fogTokenMenu]));
    const ids = menuFor(token).map((e) => e.id);
    expect(ids).toContain("fog.invisible");
    expect(ids.indexOf("fog.invisible")).toBe(ids.indexOf("map.hide") + 1);
    expect(menuFor({ ...token, invisible: true }).map((e) => e.id)).toContain("fog.invisible");
    expect(INVISIBLE_LABEL).toBe("Invisible");
  });
});
