// Templates: scn.placeTemplate / updateTemplate / deleteTemplate / clearTemplates (WS intents) and
// the `scn.template` signal (DM, players) with its audience (FR-SCN-23/24, ADR-0033).
import { SCN_SIGNALS, TemplateSignalData } from "@shared/scene-tools/schemas";
import type { Registrar } from "../../services";
import { defineSignal } from "../../ws/signals";
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
}
