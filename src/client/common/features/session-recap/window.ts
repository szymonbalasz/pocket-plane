// `recap.session` "Recap" (FR-RECAP-10; protocol §18 / §24 row), both clients: no launcher entry
// (OQ-RECAP-02 A): opened by the palette, Stats' Session tab, a share and history Open. Instance
// `main`; the picked session is view state. Useful 400 × 360: the header + the first 4 fight lines.
import { defineWindow } from "../play-shell/registry";
import { RECAP_WINDOW_KIND } from "./logic";
import { RecapWindow } from "./RecapWindow";
import { RecapRuntime } from "./runtime";

export const recapWindow = defineWindow({
  kind: RECAP_WINDOW_KIND,
  title: "Recap",
  clients: ["dm", "player"],
  defaultSize: (vp) => (vp.h >= 800 ? { w: 440, h: 560 } : { w: 440, h: 412 }),
  minSize: { w: 340, h: 320 },
  usefulSize: { w: 400, h: 360 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultOpen: false,
  companion: RecapRuntime,
  component: RecapWindow,
});
