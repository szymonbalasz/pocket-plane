// `loot.log` window geometry (FR-LOOT-15, protocol §24); each client registers its own def.
import { CoinsIcon } from "lucide-react";
import type { WindowDef } from "../play-shell/registry";
import { LOOT_LOG_KIND } from "./logic";

export const lootLogWindowBase = {
  kind: LOOT_LOG_KIND,
  title: "Party loot",
  defaultSize: { w: 440, h: 560 },
  minSize: { w: 320, h: 320 },
  defaultPosition: { anchor: "center" },
  // OQ-LOOT-07: closed by default; the launcher and the toast's "Open" open it.
  defaultOpen: false,
  launcher: { icon: CoinsIcon, label: "Loot", order: 60 },
} satisfies Omit<WindowDef, "component" | "clients">;
