// The lazy 3D chunk's entry (FR-DICEX-22, -37): `three` + `cannon-es` load only through this, by
// dynamic import from `lazy3d.ts` (preloaded at idle). Never imported statically.

export type { PreviewHandle, TrayStill } from "./preview";
export { cancelTrayStills, drawTrayStills, previewDie } from "./preview";
export type { Die3D, PlayHandle, PlayOptions, Rect, RestInfo, Still } from "./renderer";
export { playThrow } from "./renderer";
export { seedOf } from "./settle";
