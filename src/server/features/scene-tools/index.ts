// scene-tools (SCN). fix/scn-core registers the four record types; its scene-hook line lives in
// scenes-map's `scene-hooks.ts`. Commands, the move guard and the `scn.template` signal come with
// the slices (SCN §14), each in its own `register-*.ts` so parallel slices never edit one file:
// structure → `register-structure.ts`, props → `register-props.ts`, templates →
// `register-templates.ts`, diagonal rule → `register-settings.ts`.
import type { Feature } from "../../services";
import { scnRecordTypes } from "./records";
import { registerProps } from "./register-props";
import { registerSettings } from "./register-settings";
import { registerStructure } from "./register-structure";
import { registerTemplates } from "./register-templates";

export const sceneTools: Feature = {
  name: "scene-tools",
  register(r) {
    for (const t of scnRecordTypes) r.recordType(t);
    registerStructure(r);
    registerProps(r);
    registerTemplates(r);
    registerSettings(r);
  },
};
