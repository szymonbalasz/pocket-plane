// `hold.stronghold` "Stronghold" (FR-SHELL-170, -171; protocol §18 / §24 row), both clients: one
// `main` instance showing the selected stronghold (`memory.ts`); no launcher entry (FR-SHELL-172,
// OQ-HOLD-07 A): opened from the Party Manager's Strongholds tab, a reminder's link or a loot-log
// Stores name, always `by: "user"`. Loads closed by default, never protected, no keep-out, no
// activity dot. Size: 480 × 560, useful 400 × 400 (header, tab strip and three facility rows; fits
// the 1280×720 band of 412), min 340 × 360, `minOpenH` 400.
import { defineWindow } from "../play-shell/registry";
import { HOLD_WINDOW_KIND } from "./logic";
import { StrongholdWindow } from "./StrongholdWindow";

export const strongholdWindow = defineWindow({
  kind: HOLD_WINDOW_KIND,
  title: "Stronghold",
  clients: ["dm", "player"],
  defaultSize: { w: 480, h: 560 },
  usefulSize: { w: 400, h: 400 },
  minSize: { w: 340, h: 360 },
  defaultPosition: { anchor: "top-right" },
  minOpenH: 400,
  defaultOpen: false,
  component: StrongholdWindow,
});
