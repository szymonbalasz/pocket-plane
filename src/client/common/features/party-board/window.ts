// `party.board` "Party Manager" and `party.handout` window geometry (FR-PARTY-11, FR-PARTY-14,
// FR-SHELL-156; protocol §18 / §24 rows); each client registers its own defs with its own bodies.
// Sprint 9: the `party.summary` window is gone (FR-SHELL-157); `party.board` absorbs its stored
// layout entry and lands on Party status (FR-SHELL-155, FR-PARTY-64).
import { ScrollIcon } from "lucide-react";
import type { WindowDef } from "../play-shell/registry";
import { handoutActivity, PARTY_BOARD_KIND, PARTY_HANDOUT_KIND, STATUS_TAB } from "./logic";
import { tabKeyOf } from "./open-tab";
import { partyMemory } from "./seen";
import { PARTY_SUMMARY_KIND } from "./summary-logic";

type Base = Omit<WindowDef, "component" | "clients">;

export const partyBoardWindowBase = {
  kind: PARTY_BOARD_KIND,
  // FR-PARTY-59 / FR-SHELL-156: "Party Manager" (kind, test IDs and tab memory unchanged).
  title: "Party Manager",
  // FR-SHELL-156 (OQ-SHELL-78 A; BL-106, DM #341: 550 → 600), band-capped; useful 440 × 400
  // (every PC row and its companion rows whole on Party status, measured on `wf-frame-e2e`).
  defaultSize: { w: 600, h: 560 },
  usefulSize: { w: 440, h: 400 },
  minSize: { w: 340, h: 360 },
  // Left edge, clear of the tool rail (#162; where `loot.log` was before FR-PARTY-29).
  defaultPosition: { anchor: "top-left", dx: 56 },
  // No full-size slot at 1280×720 (above `dice.log`): open this tall on top, not shrunk.
  minOpenH: 400,
  defaultOpen: false,
  launcher: { icon: ScrollIcon, label: "Party Manager", order: 58 },
  // FR-PARTY-11: dot when a handout arrives or is updated while minimised.
  activity: handoutActivity,
  // FR-SHELL-155 / FR-PARTY-64: an old layout's open or minimised Party status window becomes
  // Party Manager in that state, on the Party status tab.
  absorbs: [PARTY_SUMMARY_KIND],
  onAbsorb: (_from, you) => partyMemory().tabs.choose(tabKeyOf(you), STATUS_TAB),
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
