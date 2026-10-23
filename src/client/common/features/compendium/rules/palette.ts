// The Rules window's palette entries (FR-CMP-69, FR-SHELL-186, -188), appended to `commands.ts`
// (ADR-0067): the "Open Rules" launch command and the Rules group's search provider (compendium
// search with `kind=rule`, the viewer's visibility FR-CMP-14; text matches too, as the Rules
// window's search). A rule row opens the Rules window on that card (`openRules`, `by: "user"`,
// seams S3 / S14). Client only: no intent, no record.

import type { EntrySummary } from "@shared/compendium/rest";
import { HOMEBREW_LABEL } from "@shared/compendium/rest";
import { ScrollTextIcon } from "lucide-react";
import { compendiumApi } from "../../play-shell/palette/providers";
import {
  GROUP_MAX,
  type PaletteCommand,
  type SearchHit,
  type SearchProvider,
} from "../../play-shell/palette/types";
import { eagerApi, searchCompendium } from "../search";
import { type OpenWindowFn, openRules } from "./open";

/** The slice of the palette's `ctx` the rows use (FR-SHELL-184: `ctx.shell.openWindow`). */
export interface RulesPaletteCtx {
  shell: { openWindow: OpenWindowFn };
}

/** FR-SHELL-188: a `rule` row opens the Rules window on that card (FR-CMP-69). */
export const openRuleRow = (ctx: RulesPaletteCtx, entryId: string) =>
  openRules(ctx.shell.openWindow, entryId);

/**
 * FR-SHELL-186 launch command, both clients; opens `by: "user"` (window memory and MRU). No card
 * words in its keywords: a local keyword match ranks above every server row, so "cover" must reach
 * the Rules row "Cover", not this command (SP2 re-test P4).
 */
export const rulesCommand: PaletteCommand = {
  id: "cmp.rules.open",
  title: "Open Rules",
  keywords: ["rules", "srd", "reference", "quick reference", "house rules"],
  group: "Commands",
  clients: ["dm", "player"],
  run: (ctx) => openRules(ctx.shell.openWindow),
};

/** Server rule summaries as Rules rows, ≤ 8, server order kept (house rules marked). */
export function ruleHits(results: readonly EntrySummary[]): SearchHit[] {
  return results
    .filter((r) => r.kind === "rule")
    .slice(0, GROUP_MAX)
    .map((r) => ({
      id: r.id,
      group: "Rules",
      title: r.name,
      hint: r.sourceLabel === HOMEBREW_LABEL ? `${r.line} · Homebrew` : r.line,
      kind: r.kind,
      icon: ScrollTextIcon,
      run: (ctx) => openRuleRow(ctx, r.id),
    }));
}

/** FR-SHELL-188 / -199: the Rules group (compendium search `kind=rule`). */
export const rulesProvider: SearchProvider = {
  id: "rules",
  group: "Rules",
  clients: ["dm", "player"],
  async search(q, ctx) {
    const page = await searchCompendium(eagerApi(compendiumApi(ctx.client)), { q, kind: "rule" });
    return ruleHits(page.results);
  },
};

export const SP2_COMMANDS: readonly PaletteCommand[] = [rulesCommand];
export const SP2_PROVIDERS: readonly SearchProvider[] = [rulesProvider];
