// Log-entry kind `char.rest` (FR-CHARX-124): "Mira takes a long rest", one line per rested
// character. Not public: the DM and the character's owner (`audiencePlayerId`) receive it, the
// same people who receive its sheet change (FR-CHARX-36).
import { defineLogKind } from "@shared/dice-roll-log/kind-types";
import { RestKind } from "@shared/events/character-sheet";
import { z } from "zod";

export const LOG_KIND_CHAR_REST = "char.rest";

export const CharRestLogPayload = z.strictObject({ characterId: z.string(), kind: RestKind });
export type CharRestLogPayload = z.infer<typeof CharRestLogPayload>;

export const charRestLogKind = defineLogKind<CharRestLogPayload>({
  kind: LOG_KIND_CHAR_REST,
  payload: CharRestLogPayload,
  formatLine: ({ actorName, payload: p }) => [
    { text: actorName, style: "actor" },
    { text: ` takes a ${p.kind} rest` },
  ],
});
