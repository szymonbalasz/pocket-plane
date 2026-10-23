// Command registry (FR-SHELL-184, -199, ADR-0067). APPEND-ONLY (AGENTS §9.9): a feature adds its
// commands to `COMMANDS` and its search providers to `PROVIDERS`; nothing else changes here. The
// palette lists them, the shortcut dispatcher binds their `keys` (only from play-shell §7's table,
// assigned via the integrator), the shortcuts sheet is generated from them. A command does only
// what a click in the UI does: no new intent, event or record. Windows need no line here: the
// palette's Windows group is generated from each client's `windows.ts` (FR-SHELL-185).
import { SP2_COMMANDS, SP2_PROVIDERS } from "../compendium/rules/palette";
import { PM2_COMMANDS } from "../party-board/commands";
import { SP3_COMMANDS } from "../session-recap/commands";
import { SP1_COMMANDS } from "./palette/launch";
import { SP1_PROVIDERS } from "./palette/providers";
import type { PaletteCommand, SearchProvider } from "./palette/types";

export type { CommandCtx, PaletteCommand, SearchProvider } from "./palette/types";

/** The commands (append yours). */
export const COMMANDS: readonly PaletteCommand[] = [
  // SP1 (build/sp-palette): palette, sheet, Roll dice, launch commands, window keys
  ...SP1_COMMANDS,
  // PM2 (build/party-manager): Party status (seams S3)
  ...PM2_COMMANDS,
  // SP2 (build/sp-rules): Open Rules (FR-SHELL-186, FR-CMP-69)
  ...SP2_COMMANDS,
  // SP3 (build/sp-recap): Session recap (FR-RECAP-28)
  ...SP3_COMMANDS,
];

/** The search providers, one group each or more (append yours; no strongholds yet, seams S9). */
export const PROVIDERS: readonly SearchProvider[] = [
  // SP1 (build/sp-palette): characters, creatures (DM), compendium + rules rows
  ...SP1_PROVIDERS,
  // SP2 (build/sp-rules): Rules rows (`kind=rule`) → the Rules window on the card (FR-SHELL-188)
  ...SP2_PROVIDERS,
];
