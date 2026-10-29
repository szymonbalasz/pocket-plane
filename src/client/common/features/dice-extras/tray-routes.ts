// Tray routes (FR-DICEX-102; ADR-0073 decision 3). APPEND-ONLY (AGENTS §9.9): a feature adds one
// import and one entry in the list; nothing else changes here. Contract: `TrayRoute` in
// `./tray-routing`. combat-tracker claims a combatant's free Attack / Damage (FR-CBT-172).
import { combatTrayRoute } from "../combat-tracker/tray-route";
import type { TrayRoute } from "./tray-routing";

export const trayRoutes: TrayRoute[] = [
  combatTrayRoute, // combat-tracker: rowless cbt.attack / cbt.rollDamage in combat (FR-CBT-172)
];
