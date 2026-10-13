// `cbt.initiative` window base (CBT §7, protocol §24); each client registers its own def.
import type { WindowDef } from "../play-shell/registry";
import { InitiativeIcon } from "./parts";

export const INITIATIVE_KIND = "cbt.initiative";
export const ENCOUNTERS_KIND = "cbt.encounters";

export const initiativeWindowBase = {
  kind: INITIATIVE_KIND,
  title: "Initiative",
  defaultSize: { w: 340, h: 520 },
  minSize: { w: 280, h: 240 },
  defaultOpen: true,
  launcher: { icon: InitiativeIcon, label: "Initiative", order: 50 },
} satisfies Omit<WindowDef, "component" | "clients" | "defaultPosition">;
