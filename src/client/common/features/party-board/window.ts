// `party.board` and `party.handout` window geometry (FR-PARTY-11, FR-PARTY-14; protocol §18 /
// §24 rows); each client registers its own defs with its own bodies.
import { ScrollIcon } from "lucide-react";
import type { WindowDef } from "../play-shell/registry";
import { handoutActivity, PARTY_BOARD_KIND, PARTY_HANDOUT_KIND } from "./logic";

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
