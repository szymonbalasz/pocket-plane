import type { Feature } from "../../services";
import { createEntity, updateEntityCommand } from "./commands";
import { bindDefinitionHooks, DefinitionHooks, definitionChangedHooks } from "./definition-hooks";
import { registerImport } from "./import-store";
import { petAdjustHp } from "./pet-hp";
import { createPet } from "./pets";
import { entityRecordTypes } from "./records";

export const entities: Feature = {
  name: "entities",
  register(r) {
    const s = r.services;
    // Internal `entities.import` (FR-ENT-06): plugs into the pipeline, no route.
    const hooks = new DefinitionHooks(definitionChangedHooks);
    bindDefinitionHooks(s, hooks);
    registerImport(s.imports, s.records, hooks);
    // REST + fixture steps; one WS intent, `pet.adjustHp` (sprint 6).
    r.command(createEntity);
    r.command(updateEntityCommand(hooks));
    // Sprint 6 (FR-ENT-32): `POST /api/pets` and fixture steps.
    r.command(createPet);
    // Sprint 6 (FR-ENT-36): a pet's kept HP out of a fight (DM, owner).
    r.command(petAdjustHp, { intent: true });
    for (const t of entityRecordTypes(s.log)) r.recordType(t);
  },
};
