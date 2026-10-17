// Templates: scn.placeTemplate / updateTemplate / deleteTemplate / clearTemplates (WS intents),
// the `scn.template` signal (DM, players) with its audience (FR-SCN-23/24, ADR-0033) and the
// sprint-4 boot re-derive of DM templates' fog copies (FR-SCN-46).
import { SCN_SIGNALS, TemplateSignalData } from "@shared/scene-tools/schemas";
import type { Registrar } from "../../services";
import { defineSignal } from "../../ws/signals";
import { rederiveDmTemplates } from "./template-rederive";
import {
  clearTemplates,
  deleteTemplate,
  placeTemplate,
  templateAudience,
  updateTemplate,
} from "./templates";

export function registerTemplates(r: Registrar): void {
  r.command(placeTemplate, { intent: true });
  r.command(updateTemplate, { intent: true });
  r.command(deleteTemplate, { intent: true });
  r.command(clearTemplates, { intent: true });
  r.signal(
    defineSignal({
      name: SCN_SIGNALS.template,
      schema: TemplateSignalData,
      roles: ["dm", "player"],
      audience: templateAudience,
    }),
  );
  r.onStart("scene-tools.template-rederive", (s) => {
    const n = rederiveDmTemplates(s.db);
    if (n > 0) s.log.info(`scene-tools: re-derived fog copies of ${n} DM template(s) (FR-SCN-46)`);
  });
}
