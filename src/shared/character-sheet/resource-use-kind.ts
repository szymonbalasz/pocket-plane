// Log-entry kind `char.resourceUse` (class-resources FR-CRES-12): one line per Use of a feature
// with a cost, per Flexible Casting conversion and per created slot, e.g. "Quirin · Quickened
// Spell · −2 sorcery points (3 left)". Public by default (OQ-CRES-05 A); the sender may keep it to
// the DM and the owner. `ops` are the exact counter changes, so Undo can give them back.
import { defineLogKind } from "@shared/dice-roll-log/kind-types";
import { z } from "zod";

export const LOG_KIND_RESOURCE_USE = "char.resourceUse";

const Level = z.enum(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
const Delta = z.int().min(-29).max(29);

/**
 * One counter change: a feature row's `used`, a level's `slotsUsed`, a level's `slotsCreated`
 * (the count of created slots), or `pactUsed`. `n` is added; Undo adds `-n`.
 */
export const ResourceOp = z.discriminatedUnion("on", [
  z.strictObject({ on: z.literal("feature"), id: z.string().min(1).max(64), n: Delta }),
  z.strictObject({ on: z.literal("slot"), level: Level, n: Delta }),
  z.strictObject({ on: z.literal("created"), level: Level, n: Delta }),
  z.strictObject({ on: z.literal("pact"), n: Delta }),
]);
export type ResourceOp = z.infer<typeof ResourceOp>;

export const RESOURCE_ACTIONS = ["use", "convert", "create"] as const;

export const ResourceUsePayload = z.strictObject({
  characterId: z.string(),
  action: z.enum(RESOURCE_ACTIONS),
  /** The feature's name, or the conversion ("Pact slot → sorcery points"). */
  name: z.string().min(1).max(80),
  /** What it cost or gave, in words ("−2 sorcery points", "+1 sorcery point"). */
  detail: z.string().max(80),
  /** What is left afterwards ("3 left"), when it says something. */
  left: z.string().max(40).optional(),
  ops: z.array(ResourceOp).min(1).max(4),
});
export type ResourceUsePayload = z.infer<typeof ResourceUsePayload>;

export const resourceUseLogKind = defineLogKind<ResourceUsePayload>({
  kind: LOG_KIND_RESOURCE_USE,
  payload: ResourceUsePayload,
  formatLine: ({ actorName, payload: p }) => [
    { text: actorName, style: "actor" },
    { text: ` · ${p.name}` },
    ...(p.detail ? [{ text: ` · ${p.detail}` }] : []),
    ...(p.left ? [{ text: ` (${p.left})`, style: "muted" as const }] : []),
  ],
});
