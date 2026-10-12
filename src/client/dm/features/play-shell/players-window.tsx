// `camp.players`: campaign-management's players panel as a DM window (FR-SHELL-21).
import { defineWindow } from "@ui/features/play-shell/registry";
import { UNCARD } from "@ui/features/play-shell/test-windows";
import { UsersIcon } from "lucide-react";
import { PlayersPanel } from "../campaign-management/PlayersPanel";

export const PLAYERS_KIND = "camp.players";

function PlayersBody() {
  return (
    <div className={UNCARD}>
      <PlayersPanel />
    </div>
  );
}

export const playersWindow = defineWindow({
  kind: PLAYERS_KIND,
  title: "Players",
  clients: ["dm"],
  defaultSize: { w: 540, h: 400 },
  minSize: { w: 360, h: 200 },
  defaultPosition: { anchor: "top-right" },
  defaultOpen: true,
  launcher: { icon: UsersIcon, label: "Players", order: 10 },
  component: PlayersBody,
});
