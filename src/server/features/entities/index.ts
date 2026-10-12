import type { Feature } from "../../services";
import { createEntity, updateEntityCommand } from "./commands";
import { bindDefinitionHooks, DefinitionHooks, definitionChangedHooks } from "./definition-hooks";
import { registerImport } from "./import-store";
import { entityRecordTypes } from "./records";

export const entities: Feature = {
  name: "entities",
  register(r) {
    const s = r.services;
    // Internal `entities.import` (FR-ENT-06): plugs into the pipeline, no route.
    registerImport(s.imports);
    const hooks = new DefinitionHooks(definitionChangedHooks);
    bindDefinitionHooks(s, hooks);
    // REST + fixture steps only; no WS intents (ENT §9).
    r.command(createEntity);
    r.command(updateEntityCommand(hooks));
    for (const t of entityRecordTypes(s.log)) r.recordType(t);
  },
};
