// `party.board` and `party.handout` window geometry (FR-PARTY-11, FR-PARTY-14; protocol §18 /
// §24 rows); each client registers its own defs with its own bodies. Sprint 8: `party.summary`
// (FR-SHELL-140, CB3), one def for both clients.
import { HeartPulseIcon, ScrollIcon } from "lucide-react";
import { defineWindow, type WindowDef } from "../play-shell/registry";
import { handoutActivity, PARTY_BOARD_KIND, PARTY_HANDOUT_KIND } from "./logic";
import { PartySummaryWindow } from "./Summary";
import { PARTY_SUMMARY_KIND } from "./summary-logic";

type Base = Omit<WindowDef, "component" | "clients">;

export const partyBoardWindowBase = {
  kind: PARTY_BOARD_KIND,
  title: "Party",
  defaultSize: { w: 440, h: 560 },
  minSize: { w: 340, h: 360 },
  // Left edge, clear of the tool rail (#162; where `loot.log` was before FR-PARTY-29).
  defaultPosition: { anchor: "top-left", dx: 56 },
  // No full-size slot at 1280×720 (above `dice.log`): open this tall on top, not shrunk.
  minOpenH: 400,
  defaultOpen: false,
  launcher: { icon: ScrollIcon, label: "Party", order: 58 },
  // FR-PARTY-11: dot when a handout arrives or is updated while minimised.
  activity: handoutActivity,
} satisfies Base;

export const partyHandoutWindowBase = {
  kind: PARTY_HANDOUT_KIND,
  title: "Handout",
  defaultSize: { w: 640, h: 560 },
  minSize: { w: 360, h: 320 },
  defaultPosition: { anchor: "top-right" },
  // FR-PARTY-14: images need the room; opens on top rather than shrinking to a slot.
  minOpenH: 400,
  defaultOpen: false,
} satisfies Base;

/**
 * FR-SHELL-140–142 "Party status": a launcher window right after Party, loads closed, never
 * protected, no keep-out, no activity dot; grows to its rows (FR-SHELL-141: default 280 × 260,
 * useful 280 × 236, min 240 × 120). WF's one placer picks its spot.
 */
export const partySummaryWindow = defineWindow({
  kind: PARTY_SUMMARY_KIND,
  title: "Party status",
  clients: ["dm", "player"],
  defaultSize: { w: 280, h: 260 },
  minSize: { w: 240, h: 120 },
  usefulSize: { w: 280, h: 236 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultOpen: false,
  growToContent: true,
  launcher: { icon: HeartPulseIcon, label: "Party status", order: 58.5 },
  component: PartySummaryWindow,
});
