import type { Feature } from "../../services";
import { registerImport } from "./import-store";
import { entityRecordTypes } from "./records";

export const entities: Feature = {
  name: "entities",
  register(r) {
    const s = r.services;
    // Internal `entities.import` (FR-ENT-06): plugs into the pipeline, no route.
    registerImport(s.imports);
    for (const t of entityRecordTypes(s.log)) r.recordType(t);
  },
};
