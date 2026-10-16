// Compendium (CMP, ADR-0046). C1 core: import kinds for the pipeline, `cmp.import` /
// `cmp.importRecorded`, homebrew `cmp.putEntry`. No route and no WS intent yet (C2–C4).
import type { Feature } from "../../services";
import { registerEntryImport } from "./entries";
import { putEntry } from "./homebrew";
import { importCommand, importRecordedCommand } from "./import";

export const compendium: Feature = {
  name: "compendium",
  register(r) {
    const s = r.services;
    registerEntryImport(s.imports);
    r.command(importCommand(s.imports));
    r.command(importRecordedCommand(s.imports));
    r.command(putEntry);
  },
};
