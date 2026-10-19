// FR-CBTX-56 (OQ-CBTX-29 A, sim-8 #9): one "Invisible" on the DM token menu — fog's token state
// (FR-FOG-59); the token menu's Conditions ▸ lists the 14 other conditions, the Initiative row's
// all 15. FR-FOG-59's Tooltip. The menus in the browser: e2e/init-chips-effect.e2e.ts (W7).
import { describe, expect, test } from "bun:test";
import { CONDITION_INFO, CONDITIONS } from "@shared/combat-extras/conditions";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { fogTokenMenu, INVISIBLE_LABEL, INVISIBLE_TIP } from "../fog-of-war/token-menu-entries";
import { menuFor } from "../scenes-map/token-menu";
import { cbtxTokenMenu, TOKEN_MENU_OMIT } from "./token-menu-entries";

describe("FR-CBTX-56 one Invisible item", () => {
  test("FR-CBTX-56 one Invisible item: token Conditions ▸ has 14, no Invisible; the row's keeps 15; fog's item is the menu's only Invisible", () => {
    expect(CONDITIONS).toHaveLength(15);
    expect(TOKEN_MENU_OMIT).toEqual(["invisible"]);
    const onToken = CONDITIONS.filter((k) => !TOKEN_MENU_OMIT.includes(k));
    expect(onToken).toHaveLength(14);
    expect(onToken.map((k) => CONDITION_INFO[k].name)).not.toContain(INVISIBLE_LABEL);
    expect(CONDITION_INFO.invisible.name).toBe(INVISIBLE_LABEL);
    // Both registries' lines on a token: fog's Invisible and cbtx's Conditions ▸, no other.
    const ids = menuFor({ id: "t1", hidden: false } as TokenRecord).map((e) => e.id);
    expect(ids).toContain("fog.invisible");
    expect(ids).toContain("cbtx.conditions");
    expect(cbtxTokenMenu.map((e) => e.id).filter((id) => /invisible/i.test(id))).toEqual([]);
  });
});

describe("FR-FOG-59 the one Invisible item", () => {
  test("FR-FOG-59 Invisible tooltip: says what it does; still fog's one line (the toggle: e2e W7)", () => {
    expect(INVISIBLE_TIP).toBe("Players don't see it unless they see invisible");
    expect(fogTokenMenu.map((e) => e.id)).toEqual(["fog.invisible"]);
  });
});
