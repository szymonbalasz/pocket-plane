// fog-of-war (FOG): record types `fog`, `fog-explored`, `vision`, `fog-settings` and the DM-only
// intents `fog.edit` / `fog.setAll` / `fog.undo` / `fog.redo`, darkness place / move / remove /
// clear, `fog.setExplored` / `fog.forgetExplored`, `fog.setInvisible`, `fog.setPartyVision`
// (FOG §9). Its lines in scenes-map's `visibility-hooks.ts` / `scene-hooks.ts` and
// campaign-management's `player-hooks.ts` live in `hooks.ts`. FR-FOG-40: the per-player copies
// are backfilled before the server listens, then the vision-model upgrade runs (sprint 4).
import { realContext } from "../../commands/context";
import type { Feature } from "../../services";
import { backfillSeenBy } from "./backfill";
import { fogCommands } from "./commands";
import { fogExploredRecordType, fogRecordType, visionRecordType } from "./records";
import { fogSettingsRecordType } from "./settings";
import { setFogLogger } from "./sight";
import { upgradeVisionModel } from "./upgrade";

export const fogOfWar: Feature = {
  name: "fog-of-war",
  register(r) {
    r.recordType(fogRecordType);
    r.recordType(fogExploredRecordType);
    r.recordType(visionRecordType);
    r.recordType(fogSettingsRecordType);
    const c = fogCommands(r.services.log);
    r.command(c.edit, { intent: true });
    r.command(c.setAll, { intent: true });
    r.command(c.undo, { intent: true });
    r.command(c.redo, { intent: true });
    r.command(c.placeDarkness, { intent: true });
    r.command(c.moveDarkness, { intent: true });
    r.command(c.removeDarkness, { intent: true });
    r.command(c.clearDarkness, { intent: true });
    r.command(c.setExplored, { intent: true });
    r.command(c.forgetExplored, { intent: true });
    r.command(c.setInvisible, { intent: true });
    r.command(c.setPartyVision, { intent: true });
    setFogLogger(r.services.log);
    r.onStart("fog-of-war.seen-by-backfill", (s) => {
      const n = backfillSeenBy(s.db, realContext(s.clock));
      if (n > 0) s.log.info(`fog: backfilled per-player copies on ${n} scene(s) (FR-FOG-40)`);
    });
    r.onStart("fog-of-war.vision-model-upgrade", (s) => {
      const n = upgradeVisionModel(s.db, realContext(s.clock));
      if (n > 0) s.log.info(`fog: vision model upgraded; re-derived ${n} scene(s) (FR-FOG-40)`);
    });
  },
};
