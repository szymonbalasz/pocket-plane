import { expect, test } from "bun:test";
import { fittedDefaultRect } from "@ui/features/play-shell/placement";
import { notificationsHistoryWindow as player } from "./history-window";

// FR-NOTE-31: root cause was each client's override (DM 360×320, player 360×300); both now use
// the shared def's 360×480, which the default rect keeps at 1440×900 and 1280×720.
test("FR-NOTE-31 history geometry: player def is 360×480, min 280×240, unshrunk by the default fit", () => {
  for (const def of [player]) {
    expect(def.defaultSize).toEqual({ w: 360, h: 480 });
    expect(def.minSize).toEqual({ w: 280, h: 240 });
    for (const vp of [
      { w: 1440, h: 900 },
      { w: 1280, h: 720 },
    ]) {
      const r = fittedDefaultRect(def, vp);
      expect({ w: r.w, h: r.h }).toEqual({ w: 360, h: 480 });
    }
  }
});
