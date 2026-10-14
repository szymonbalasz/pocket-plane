// Sheet sections registry (CHARX §7.1, FR-CHARX-34). APPEND-ONLY (AGENTS §9.9): a feature adds
// one import and one line; nothing else changes here. Contract: `SheetSection` in `./sections`.
// combat-extras adds `cbtx.temp-hp`, `cbtx.death-saves` (vitals) and `cbtx.effects` (header).
import type { SheetSection } from "./sections";

export const sheetSections: readonly SheetSection[] = [];
