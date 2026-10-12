// DM window registry (FR-SHELL-07, ADR-0025). APPEND-ONLY (AGENTS §9.9): a feature adds one
// import and one line in the list for each of its DM window types; nothing else changes here.
import { createWindowRegistry, type WindowDef } from "@ui/features/play-shell/registry";
import { shellTestWindow, syncProbesWindow } from "@ui/features/play-shell/test-windows";
import { assetTestWindow } from "./features/assets-pipeline/asset-test-window";
import { creaturesWindow } from "./features/entities/creatures-window";
import { playersWindow } from "./features/play-shell/players-window";

const windows: WindowDef[] = [
  playersWindow, // camp.players (play-shell, FR-SHELL-21)
  syncProbesWindow, // sync.probes, test mode (play-shell, FR-SHELL-21)
  shellTestWindow, // shell.test, test mode (play-shell, FR-SHELL-20)
  assetTestWindow, // asset.test, test mode (assets-pipeline, FR-ASSET-19)
  creaturesWindow, // ent.creatures (entities, FR-ENT-18)
];

export const dmWindows = createWindowRegistry("dm", windows);
