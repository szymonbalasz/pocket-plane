// Tray extras (FR-DICEX-08 b; seams S4). APPEND-ONLY (AGENTS §9.9): a feature adds one import and
// one entry in the list; nothing else changes here. Each entry's dice show as labelled read-only
// chips beside the base dice in `compose` / `adjust` (e.g. MOD tier 2: "Bless 1d4"). DICEX ships
// it empty.
import type { RollMode } from "@shared/dice-roll-log/schemas";
import type { TrayRequest } from "./store";

export interface TrayExtraDice {
  label: string;
  faces: number;
  count: number;
  sign: 1 | -1;
}

export interface TrayExtra {
  key: string;
  /** Ascending, left to right. */
  order: number;
  /** A React hook (called once per render, in `order`): the extra dice for this request. */
  useDice(request: TrayRequest, mode: RollMode): TrayExtraDice[];
}

export const trayExtras: TrayExtra[] = [];
