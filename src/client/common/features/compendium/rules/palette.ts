// The Rules window's palette parts (FR-CMP-69, FR-SHELL-186, -188), for `commands.ts` (SP1's
// append-only registry, ADR-0067): the "Rules" launch command and the action of a `rule` row
// (opens the Rules window on that card). Rule rows themselves come from SP1's compendium search
// (`kind=rule`, the viewer's visibility). Until the registry exists these are the whole seam; its
// owner appends one line per entry. Client only: no intent, no record.
import { type OpenWindowFn, openRules } from "./open";

/** The slice of the palette's `ctx` these entries use (FR-SHELL-184: `ctx.shell.openWindow`). */
export interface RulesPaletteCtx {
  shell: { openWindow: OpenWindowFn };
}

/** FR-SHELL-186 launch command "Rules", both clients; opens `by: "user"` (seams S3, S14). */
export const rulesCommand = {
  id: "cmp.rules.open",
  title: "Rules",
  keywords: ["rules", "srd", "reference", "conditions", "cover", "actions", "house rules"],
  group: "Commands",
  clients: ["dm", "player"] as const,
  run: (ctx: RulesPaletteCtx) => openRules(ctx.shell.openWindow),
};

/** FR-SHELL-188: a `rule` row opens the Rules window on that card (FR-CMP-69). */
export const openRuleRow = (ctx: RulesPaletteCtx, entryId: string) =>
  openRules(ctx.shell.openWindow, entryId);
