// `cmp.rules` "Rules" window geometry (FR-CMP-63; protocol §24 row), both clients: an ordinary
// launcher window after Compendium, default closed, opened by the user only (launcher, palette,
// Open in Rules). 480 × 600 (short viewports: 480 × 412, the band), min 340 × 320; useful
// 420 × 360 = the page Tabs and three card headings visible (`useful-size.e2e.ts`). Each client
// registers its own def with its own body (DM: New house rule; player: `Authorization: Player`).
import { ScrollTextIcon } from "lucide-react";
import { isTall, type WindowDef } from "../../play-shell/registry";
import { RULES_KIND } from "./logic";

type Base = Omit<WindowDef, "component" | "clients">;

export const rulesWindowBase = {
  kind: RULES_KIND,
  title: "Rules",
  defaultSize: (vp) => (isTall(vp) ? { w: 480, h: 600 } : { w: 480, h: 412 }),
  minSize: { w: 340, h: 320 },
  usefulSize: { w: 420, h: 360 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultOpen: false,
  launcher: { icon: ScrollTextIcon, label: "Rules", order: 66 },
} satisfies Base;
