// Party Manager's palette command (seams S3, FR-SHELL-186): "Party status" opens Party Manager on
// its Party status tab, as `openPartyTab("status")` (FR-PARTY-64) through the palette's shell
// (`by: "user"`). Both clients; no intent.
import type { PaletteCommand } from "../play-shell/palette/types";
import { STATUS_TAB } from "./logic";
import { openPartyTab } from "./open-tab";

export const PM2_COMMANDS: readonly PaletteCommand[] = [
  {
    id: "party.status",
    title: "Party status",
    keywords: ["party manager", "hp", "companions", "pets"],
    group: "Commands",
    clients: ["dm", "player"],
    run: (ctx) =>
      openPartyTab(STATUS_TAB, { you: ctx.store.you, open: (kind) => ctx.shell.openWindow(kind) }),
  },
];
