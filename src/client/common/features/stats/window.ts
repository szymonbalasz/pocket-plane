// `stats.board` "Stats" (FR-SHELL-93, FR-SHELL-86 contract; protocol §18 / §24 row), both
// clients: an ordinary launcher window (parkable, never protected, no keep-out), right after Party.
// *(Sprint 8)* FR-STATS-66 (BL-66): useful 400 × 360, checked by content in `useful-size.e2e.ts`.
import { TrophyIcon } from "lucide-react";
import { defineWindow } from "../play-shell/registry";
import { STATS_WINDOW_KIND } from "./logic";
import { StatsRuntime } from "./runtime";
import { StatsWindow } from "./StatsWindow";

export const statsWindow = defineWindow({
  kind: STATS_WINDOW_KIND,
  title: "Stats",
  clients: ["dm", "player"],
  defaultSize: { w: 400, h: 412 },
  minSize: { w: 320, h: 280 },
  // FR-STATS-66: 5 rows with names whole, or 2 award cards, or the first 4 Highlights lines.
  usefulSize: { w: 400, h: 360 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultOpen: false,
  launcher: { icon: TrophyIcon, label: "Stats", order: 59 },
  companion: StatsRuntime,
  component: StatsWindow,
});
