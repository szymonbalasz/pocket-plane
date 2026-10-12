// `char.sheet` window geometry (CHAR §7, protocol §24); each client registers its own def.
import type { WindowDef } from "../play-shell/registry";

export const CHAR_SHEET_KIND = "char.sheet";

export const charSheetWindowBase = {
  kind: CHAR_SHEET_KIND,
  title: "Character sheet",
  defaultSize: { w: 320, h: 440 },
  minSize: { w: 280, h: 320 },
} satisfies Partial<WindowDef>;
