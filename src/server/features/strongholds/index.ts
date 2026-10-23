// strongholds (HOLD): record types `stronghold` (lazy `"all"`) and `stronghold-index` (derived,
// in the snapshot), the `hold.*` intents (DM). Stores live in party-loot / party-board (the
// `stores` holder, ADR-0066); `stores-coin` is party-loot's record type.
import type { Feature } from "../../services";
import {
  createStronghold,
  deleteStronghold,
  moveRow,
  removeFacility,
  removeStaff,
  saveFacility,
  saveStaff,
  updateStronghold,
} from "./commands";
import { saveFacilityByName, saveReminderByName, saveStaffByName } from "./fixture-commands";
import { strongholdIndexType, strongholdType } from "./records";

export const strongholds: Feature = {
  name: "strongholds",
  register(r) {
    r.recordType(strongholdType);
    r.recordType(strongholdIndexType);
    r.command(createStronghold, { intent: true });
    r.command(updateStronghold, { intent: true });
    r.command(saveFacility, { intent: true });
    r.command(saveStaff, { intent: true });
    r.command(moveRow, { intent: true });
    r.command(removeStaff, { intent: true });
    r.command(removeFacility, { intent: true });
    r.command(deleteStronghold, { intent: true });
    // Internal: fixture loader only. No route, no WS intent.
    r.command(saveFacilityByName);
    r.command(saveStaffByName);
    r.command(saveReminderByName);
  },
};
