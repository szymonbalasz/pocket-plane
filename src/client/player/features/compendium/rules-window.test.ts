// FR-CMP-63 player registry (seams S4): `cmp.rules` "Rules", default closed, launcher after
// Compendium, 440 × 600 (short viewports 440 × 412; FR-SHELL-61 width, not 480), min 340 × 320, useful 420 × 360, and its
// size-table row with a content criterion.
import { expect, test } from "bun:test";
import { defaultSizeAt } from "@ui/features/play-shell/registry";
import { SIZE_TABLE } from "@ui/features/play-shell/size-table";

const { playerWindows: windows } = await import("../../windows");

test("FR-CMP-63 rules window registered (player): cmp.rules 'Rules', closed by default, ScrollText launcher right after Compendium; sizes per FR-CMP-63; size-table row with a content criterion", () => {
  const d = windows.get("cmp.rules");
  expect(d).toMatchObject({
    title: "Rules",
    minSize: { w: 340, h: 320 },
    usefulSize: { w: 420, h: 360 },
  });
  expect(d?.defaultOpen).toBeFalsy();
  expect(d?.launcher?.label).toBe("Rules");
  const orders = windows.defs
    .filter((x) => x.launcher)
    .sort((a, b) => (a.launcher?.order ?? 0) - (b.launcher?.order ?? 0))
    .map((x) => x.kind);
  expect(orders[orders.indexOf("cmp.compendium") + 1]).toBe("cmp.rules");
  if (!d) throw new Error("not registered");
  expect(defaultSizeAt(d, { w: 1280, h: 720 })).toEqual({ w: 440, h: 412 });
  expect(defaultSizeAt(d, { w: 1440, h: 900 })).toEqual({ w: 440, h: 600 });
  const row = SIZE_TABLE.player["cmp.rules"];
  expect(row?.criterion).toBe("page Tabs + 3 card headings");
  expect(row?.protected).toBeUndefined();
});
