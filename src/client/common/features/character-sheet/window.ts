// `char.sheet` window geometry (CHAR §7, protocol §24); each client registers its own def.
import type { Viewport } from "../play-shell/geometry";
import type { Size, WindowDef } from "../play-shell/registry";
import { resetSheetSelection } from "./selection";

export const CHAR_SHEET_KIND = "char.sheet";

/** Viewports this wide (1080p screens) open the enlarged sheet; the four reference sizes don't. */
export const SHEET_WIDE_VW = 1680;
const NARROW: Size = { w: 320, h: 440 };
/** The kit's enlarged sheet: 680 wide, so it opens in the wide layout (FR-CHARX-112). */
export const SHEET_WIDE: Size = { w: 680, h: 560 };

export const charSheetWindowBase = {
  kind: CHAR_SHEET_KIND,
  title: "Character sheet",
  defaultSize: (vp: Viewport) => (vp.w >= SHEET_WIDE_VW ? SHEET_WIDE : NARROW),
  // FR-SHELL-53: no class viewport reaches SHEET_WIDE_VW, so the wide default is listed here; a
  // stored sheet at either default takes the current viewport's one.
  previousDefaults: [SHEET_WIDE],
  minSize: { w: 280, h: 320 },
  onClose: resetSheetSelection, // FR-SHELL-200: the picked creature
} satisfies Partial<WindowDef>;
