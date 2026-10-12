import type { Feature } from "../../services";
import { importBatchCommand } from "./import-pipeline";

export const fixturesAdapters: Feature = {
  name: "fixtures-adapters",
  register(r) {
    // Internal command: fixture loader only. No route, no WS intent (FR-FIX-24).
    r.command(importBatchCommand(r.services.imports));
  },
};
