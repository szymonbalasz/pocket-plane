// Log-entry kind `cbt.companion` (sprint 6, FR-CBT-122, #252): one line per summon, dismiss,
// owner / mode change, release or turn hostile. Players read "Mira summons Fire Elemental ×2" /
// "Fire Elemental is dismissed" / "Owlbear now follows Brakka" / "Goblin 2 no longer follows
// Mira" / "Fire Elemental turns hostile" (the entry's `public` = the combatant is not hidden);
// the DM reads "DM — …" plus the turn mode ("(in Brakka's turn)").
import { defineLogKind, type LineSegment } from "@shared/dice-roll-log/kind-types";
import { TurnMode } from "@shared/entities/schemas";
import { z } from "zod";

export const LOG_KIND_COMPANION = "cbt.companion";

export const COMPANION_ACTIONS = ["summon", "dismiss", "follows", "release", "hostile"] as const;
export const CompanionAction = z.enum(COMPANION_ACTIONS);
export type CompanionAction = z.infer<typeof CompanionAction>;

export const CompanionLogPayload = z.strictObject({
  action: CompanionAction,
  /** The companion's (summon: the definition's) name. */
  name: z.string(),
  /** The owner PC's name (the new one for `follows`, the old one for `release`). */
  ownerName: z.string().optional(),
  /** `summon`: how many (1–8). */
  count: z.int().min(1).max(8).optional(),
});
export type CompanionLogPayload = z.infer<typeof CompanionLogPayload>;

/** DM only: the turn mode the companion now has (FR-CBT-122). */
export const CompanionLogDmPayload = z.strictObject({ turnMode: TurnMode.optional() });
export type CompanionLogDmPayload = z.infer<typeof CompanionLogDmPayload>;

/** "after Mira" / "in Mira's turn" / "own initiative" (FR-CBT-118's labels in words). */
export function turnModeWords(mode: TurnMode, ownerName: string): string {
  if (mode === "after-owner") return `after ${ownerName}`;
  if (mode === "in-owner-turn") return `in ${ownerName}'s turn`;
  return "own initiative";
}

export function companionText(p: CompanionLogPayload): string {
  const owner = p.ownerName ?? "";
  switch (p.action) {
    case "summon":
      return `${owner} summons ${p.name}${p.count && p.count > 1 ? ` ×${p.count}` : ""}`;
    case "dismiss":
      return `${p.name} is dismissed`;
    case "follows":
      return `${p.name} now follows ${owner}`;
    case "release":
      return `${p.name} no longer follows ${owner}`;
    case "hostile":
      return `${p.name} turns hostile`;
  }
}

export const companionLogKind = defineLogKind<CompanionLogPayload, CompanionLogDmPayload>({
  kind: LOG_KIND_COMPANION,
  payload: CompanionLogPayload,
  dmPayload: CompanionLogDmPayload,
  formatLine({ actorName, payload: p, dmPayload: dm }) {
    const text = companionText(p);
    if (!dm) return [{ text }];
    const out: LineSegment[] = [{ text: actorName, style: "actor" }, { text: ` — ${text}` }];
    if (dm.turnMode && p.ownerName) {
      out.push({ text: ` (${turnModeWords(dm.turnMode, p.ownerName)})`, style: "muted" });
    }
    return out;
  },
});
