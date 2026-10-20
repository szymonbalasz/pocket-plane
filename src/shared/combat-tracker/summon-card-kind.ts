// Notification kind `cbt-summon-concentration` (sprint 6, FR-CBT-120, OQ-CBT-81 B): the DM's card
// "Mira lost concentration (Conjure Elemental): Fire Elemental, Fire Elemental 2" when the
// concentration its summons were linked to ends. Action Dismiss (DM: `cbt.dismiss
// {notificationId}`), view button Turn hostile (`cbt.setCompanion`), the notification's own
// Dismiss = keep them. Closes with its encounter (FR-NOTE-23) and resolves itself once none of
// its summons is left with its owner.
import type { EncounterEndRule } from "@shared/notifications/end-rule";
import { TEXT_MAX } from "@shared/notifications/schemas";
import { z } from "zod";
import { COMPANIONS_PER_OWNER_MAX } from "./schemas";

export const SUMMON_CARD_KIND = "cbt-summon-concentration";

export const SummonCardPayload = z.strictObject({
  encounterId: z.string(),
  ownerCharacterId: z.string(),
  /** The ended concentration effect. */
  effectId: z.string(),
  /** The summons that were linked to it, at the card's creation (seq order). */
  combatantIds: z.array(z.string()).min(1).max(COMPANIONS_PER_OWNER_MAX),
});
export type SummonCardPayload = z.infer<typeof SummonCardPayload>;

/**
 * `dismissed`: the card's action; `hostile`: the last of its summons turned hostile; `gone`:
 * none left otherwise (the owner's Dismiss, a release, the DM's row Dismiss).
 */
export const SUMMON_CARD_OUTCOMES = ["dismissed", "hostile", "gone"] as const;
export const SummonCardResolution = z.strictObject({ outcome: z.enum(SUMMON_CARD_OUTCOMES) });
export type SummonCardResolution = z.infer<typeof SummonCardResolution>;

/** FR-NOTE-23: a pending card closes with its encounter (End dismisses it). */
export const summonCardEndRule: EncounterEndRule = {
  onEncounterEnd: "dismiss",
  encounterIdOf: (p) => {
    const r = SummonCardPayload.safeParse(p);
    return r.success ? r.data.encounterId : null;
  },
};

/** The action's label: one summon or several. */
export const summonCardAction = (count: number) =>
  count === 1 ? "Dismiss summon" : "Dismiss summons";

/**
 * "Mira lost concentration (Conjure Elemental): Fire Elemental, Fire Elemental 2"; names that
 * don't fit the notification text cap end in "+N more".
 */
export function summonCardText(owner: string, effect: string, names: readonly string[]): string {
  const head = `${owner} lost concentration${effect ? ` (${effect})` : ""}: `;
  for (let n = names.length; n >= 1; n--) {
    const rest = names.length - n;
    const text = `${head}${names.slice(0, n).join(", ")}${rest > 0 ? ` +${rest} more` : ""}`;
    if ([...text].length <= TEXT_MAX) return text;
  }
  return [...`${head}${names.length} summons`].slice(0, TEXT_MAX).join("");
}

/** The resolved card's outcome line. */
export function summonCardOutcome(r: unknown): string {
  const p = SummonCardResolution.safeParse(r);
  if (!p.success) return "Resolved";
  if (p.data.outcome === "dismissed") return "Dismissed";
  if (p.data.outcome === "hostile") return "Turned hostile";
  return "No longer linked";
}
