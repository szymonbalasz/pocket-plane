// Scene hook line of overview scenes (FR-OVW-06, ADR-0075 Decision 3): `map.activateScene` turns a
// shown overview off in its transaction. Kept free of command imports: the scenes-map registries
// load it.
import { eq } from "drizzle-orm";
import { overview } from "../../db/schema";
import type { SceneHook } from "../scenes-map/scene-hooks";
import { overviewChange, readOverview, shownOverviewOf } from "./rows";

export const overviewSceneHook: SceneHook = {
  name: "overview-scenes.one-shown",
  activated({ tx, ctx }, s) {
    const shown = shownOverviewOf(tx, s.campaignId);
    if (!shown) return [];
    tx.update(overview)
      .set({ active: false, updatedAt: ctx.clock.iso() })
      .where(eq(overview.id, shown.id))
      .run();
    return [overviewChange(shown, readOverview(tx, shown.id))];
  },
};
