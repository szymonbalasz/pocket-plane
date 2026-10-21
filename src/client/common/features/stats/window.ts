// `stats.board` "Stats" (FR-SHELL-93, FR-SHELL-86 contract; protocol §18 / §24 row), both
// clients: an ordinary launcher window (parkable, never protected, no keep-out), right after Party.
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
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultOpen: false,
  launcher: { icon: TrophyIcon, label: "Stats", order: 59 },
  companion: StatsRuntime,
  component: StatsWindow,
});
