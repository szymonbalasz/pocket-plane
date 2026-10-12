import type { Feature } from "../../services";
import { presenceRecordType } from "./presence";
import { probeEdit, probeRecordType, probeSet } from "./probe";

export const liveSync: Feature = {
  name: "live-sync",
  register(r) {
    r.recordType(presenceRecordType);
    // Sync probe exists only in test mode (FR-SYNC-27).
    if (r.services.config.testMode) {
      r.recordType(probeRecordType);
      r.command(probeSet, { intent: true });
      r.command(probeEdit, { intent: true });
    }
  },
};
