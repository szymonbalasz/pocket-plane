// The Recap's palette command (FR-RECAP-28, FR-SHELL-186): "Session recap" opens `recap.session` on
// the newest session through the palette's shell (`by: "user"`). Both clients; no intent.
import type { PaletteCommand } from "../play-shell/palette/types";
import { openRecap } from "./open";

export const SP3_COMMANDS: readonly PaletteCommand[] = [
  {
    id: "recap.open",
    title: "Session recap",
    keywords: ["recap", "summary", "session"],
    group: "Commands",
    clients: ["dm", "player"],
    run: (ctx) =>
      openRecap(null, {
        you: ctx.store.you,
        open: (kind) => ctx.shell.openWindow(kind),
        by: "user",
      }),
  },
];
