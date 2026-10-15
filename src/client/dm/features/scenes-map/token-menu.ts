// DM token menu + token double-click registry (FR-MAP-29, CON-33). APPEND-ONLY (AGENTS §9.9):
// a feature adds one import and its lines; nothing else changes here. Players get no menu.
import type { TokenRecord } from "@shared/scenes-map/schemas";
import type { ComponentType } from "react";
import { cbtxTokenMenu } from "../combat-extras/token-menu-entries";
import { combatTokenMenu } from "../combat-tracker/token-menu-entries";
import { modTokenMenu } from "../effect-modifiers/token-menu-entries";
import { scenesMapTokenMenu } from "./token-menu-entries";

export interface TokenMenuItemProps {
  token: TokenRecord;
  /** Opens this entry's `Dialog` for the token (the menu closes first). */
  openDialog(): void;
}

export interface TokenMenuDialogProps {
  token: TokenRecord;
  close(): void;
}

export interface TokenMenuEntry {
  /** `<feature>.<what>`, unique. */
  id: string;
  /** Ascending, top to bottom; scenes-map uses 10–60. */
  order: number;
  /** Hidden when false (e.g. combat: only tokens bound to a combatant). */
  available?(t: TokenRecord): boolean;
  /** Renders one or more `DropdownMenu*` items. */
  Item: ComponentType<TokenMenuItemProps>;
  Dialog?: ComponentType<TokenMenuDialogProps>;
}

export interface TokenDoubleClick {
  id: string;
  order: number;
  available(t: TokenRecord): boolean;
  /** Same dialog mechanism as the menu. */
  Dialog: ComponentType<TokenMenuDialogProps>;
}

/** The token menu. Append your feature's entries. */
export const tokenMenuEntries: readonly TokenMenuEntry[] = [
  ...scenesMapTokenMenu, // scenes-map (FR-MAP-18)
  ...combatTokenMenu, // combat-tracker: "Damage / heal…", "Remove from combat" (FR-CBT-30)
  ...cbtxTokenMenu, // combat-extras: Conditions ▸, Effect…, Temp HP…, Add to combat (FR-CBTX-35)
  ...modTokenMenu, // effect-modifiers: Apply effect ▸, Effect modifiers… (FR-MOD-28)
];

/** Token double-click: the first available entry by order runs. Append your feature's line. */
export const tokenDoubleClick: readonly TokenDoubleClick[] = [];

export function menuFor(
  t: TokenRecord,
  entries: readonly TokenMenuEntry[] = tokenMenuEntries,
): TokenMenuEntry[] {
  return [...entries].sort((a, b) => a.order - b.order).filter((e) => e.available?.(t) ?? true);
}

export function doubleClickFor(
  t: TokenRecord,
  entries: readonly TokenDoubleClick[] = tokenDoubleClick,
): TokenDoubleClick | null {
  return [...entries].sort((a, b) => a.order - b.order).find((e) => e.available(t)) ?? null;
}
