// Log-entry kind `cbt.side` (FR-CBT-99, #252): one line per `cbt.setSide`. Players read
// "Goblin 2 is now an ally" (only when the side they see changed and the combatant is visible to
// them: the entry's `public`); the DM reads "DM — Goblin 2 is now an ally" (+ " (secret)").
import { defineLogKind } from "@shared/dice-roll-log/kind-types";
import { z } from "zod";
import { LOG_KIND_SIDE, Side } from "./schemas";

export const SideLogPayload = z.strictObject({ targetName: z.string(), side: Side });
export type SideLogPayload = z.infer<typeof SideLogPayload>;

/** DM only: a secret change (players keep the side they were last openly shown). */
export const SideLogDmPayload = z.strictObject({ secret: z.boolean() });
export type SideLogDmPayload = z.infer<typeof SideLogDmPayload>;

export const sideLogKind = defineLogKind<SideLogPayload, SideLogDmPayload>({
  kind: LOG_KIND_SIDE,
  payload: SideLogPayload,
  dmPayload: SideLogDmPayload,
  formatLine({ actorName, payload: p, dmPayload: dm }) {
    const text = `${p.targetName} is now ${p.side === "ally" ? "an ally" : "an enemy"}`;
    if (!dm) return [{ text }];
    return [
      { text: actorName, style: "actor" },
      { text: ` — ${text}` },
      ...(dm.secret ? [{ text: " (secret)", style: "muted" as const }] : []),
    ];
  },
});
