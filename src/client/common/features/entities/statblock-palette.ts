// Kit parity K7 (FR-KIT-100, ruling A 2026-10-27): the DM's palette command "Stat block" opens
// `ent.statblock` (no launcher entry: the bar overflowed in test mode, the notifications / theme
// gates) with the last creature, else its empty state, as a launcher click did (`by: "user"`).
// Only the kind's name lives here: the window is DM-only code (FR-KIT-107); no intent.
import type { PaletteCommand } from "../play-shell/palette/types";

/** The DM window's kind (`dm/features/entities/statblock/logic.ts` `STATBLOCK_KIND`). */
const STATBLOCK_WINDOW = "ent.statblock";

export const K7_COMMANDS: readonly PaletteCommand[] = [
  {
    id: "ent.statblock.open",
    title: "Stat block",
    keywords: ["stat block", "monster", "creature", "statblock"],
    group: "Commands",
    clients: ["dm"],
    when: (ctx) => ctx.available.has(STATBLOCK_WINDOW),
    run: (ctx) => ctx.shell.openWindow(STATBLOCK_WINDOW),
  },
];
