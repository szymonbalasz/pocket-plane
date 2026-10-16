// `cmp.compendium` window geometry (FR-CMP-18; protocol §24 row); each client registers its own
// def with its own body (DM: import panel, drag sources; player: `Authorization: Player`).
import { BookOpenIcon } from "lucide-react";
import type { WindowDef } from "../play-shell/registry";
import { CMP_KIND } from "./logic";

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
} satisfies Base;
