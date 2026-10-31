// `cmp.compendium` window geometry (FR-CMP-18; protocol §24 row); each client registers its own
// def with its own body (DM: import panel, drag sources; player: `Authorization: Player`).
import { BookOpenIcon } from "lucide-react";
import type { WindowDef } from "../play-shell/registry";
import { CMP_ENTRY_KIND, CMP_KIND } from "./logic";
import { resetCmpNav } from "./nav";
import { POPOUT_TITLE, PopoutTitle } from "./popout";

type Base = Omit<WindowDef, "component" | "clients">;

export const compendiumWindowBase = {
  kind: CMP_KIND,
  title: "Compendium",
  defaultSize: { w: 440, h: 560 },
  minSize: { w: 320, h: 360 },
  // Left edge, clear of the tool rail, as `party.board` / `loot.log` (#162).
  defaultPosition: { anchor: "top-left", dx: 56 },
  // No full-size slot at 1280×720 (above `dice.log`): open this tall on top, not shrunk.
  minOpenH: 400,
  defaultOpen: false,
  launcher: { icon: BookOpenIcon, label: "Compendium", order: 65 },
  onClose: resetCmpNav, // FR-SHELL-200: search, tab, filters, the open entry
} satisfies Base;

/** `cmp.entry`, an entry popped out of the Compendium (FR-CMP-76); no launcher, one per entry. */
export const entryWindowBase = {
  kind: CMP_ENTRY_KIND,
  title: POPOUT_TITLE,
  titleView: PopoutTitle,
  popout: true,
  defaultSize: { w: 400, h: 500 },
  minSize: { w: 300, h: 240 },
  usefulSize: { w: 360, h: 360 },
  minOpenH: 360,
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultOpen: false,
} satisfies Base;
