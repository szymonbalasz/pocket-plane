// Canvas tool registry (FR-SCN-06, FR-FOG-17). APPEND-ONLY (AGENTS §9.9): a feature adds one import
// and one line. Entry shape and dispatch rules: `tools.ts`. Rail buttons follow the base tools by
// `order`; the active tool's `panel` shows beside the rail; MapCanvas sends stage pointer events
// to its `pointer` handlers (Space + drag pans, Esc goes to the tool first, tokens ignore
// left-press). SCN adds Structure, Props (DM) and AoE (both); FOG adds its tool.
import { propsTool } from "../scene-tools/PropsTool";
import { type CanvasToolDef, orderTools } from "./tools";

export const canvasTools: readonly CanvasToolDef[] = orderTools([
  propsTool, // scene-tools Props (DM, FR-SCN-16–18)
]);
