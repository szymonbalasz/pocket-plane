// DM window registry (FR-SHELL-07, ADR-0025). APPEND-ONLY (AGENTS §9.9): a feature adds one
// import and one line in the list for each of its DM window types; nothing else changes here.
import { createWindowRegistry, type WindowDef } from "@ui/features/play-shell/registry";

const windows: WindowDef[] = [
  // one line per window type, e.g. `scenesWindow,`
];

export const dmWindows = createWindowRegistry("dm", windows);
