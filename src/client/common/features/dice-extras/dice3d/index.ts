// The lazy 3D chunk's entry (FR-DICEX-22): `three` + `cannon-es` load only through this, by
// dynamic import from `lazy3d.ts`, on the first 3D throw. Never imported statically.
export type { Die3D, PlayHandle, PlayOptions, RestInfo } from "./renderer";
export { playThrow } from "./renderer";
export { seedOf } from "./settle";
