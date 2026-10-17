// Domain events of scene-tools (SCN §9, protocol §36). All logged; none ADR-0016-undoable (the
// DM's drawing undo sends inverse intents, FR-SCN-15). Every structure op emits one name,
// `StructureEdited`, so players can't tell a lock from a wall edit (FR-SCN-33).
import { DiagonalRule } from "@shared/scene-tools/schemas";
import { z } from "zod";
import { defineEvent } from "./types";

export const STRUCTURE_OPS = ["addWalls", "addDoor", "removeSegments", "setDoor"] as const;
export const StructureOp = z.enum(STRUCTURE_OPS);

const logged = { logged: true, undoable: false } as const;
const propPayload = z.object({ propId: z.string() }).strict();
const templatePayload = z.object({ templateId: z.string() }).strict();

/** `scn.addWalls` / `addDoor` / `removeSegments` / `setDoor`: the `n`s touched. */
export const StructureEdited = defineEvent({
  type: "StructureEdited",
  payload: z
    .object({ sceneId: z.string(), op: StructureOp, ns: z.array(z.number().int()) })
    .strict(),
  ...logged,
});

export const PropPlaced = defineEvent({ type: "PropPlaced", payload: propPayload, ...logged });
export const PropUpdated = defineEvent({ type: "PropUpdated", payload: propPayload, ...logged });
export const PropHidden = defineEvent({ type: "PropHidden", payload: propPayload, ...logged });
export const PropRevealed = defineEvent({ type: "PropRevealed", payload: propPayload, ...logged });
export const PropDuplicated = defineEvent({
  type: "PropDuplicated",
  payload: propPayload,
  ...logged,
});
export const PropDeleted = defineEvent({ type: "PropDeleted", payload: propPayload, ...logged });

export const TemplatePlaced = defineEvent({
  type: "TemplatePlaced",
  payload: templatePayload,
  ...logged,
});
export const TemplateUpdated = defineEvent({
  type: "TemplateUpdated",
  payload: templatePayload,
  ...logged,
});
export const TemplateDeleted = defineEvent({
  type: "TemplateDeleted",
  payload: templatePayload,
  ...logged,
});
/**
 * `scn.clearTemplates` (FR-SCN-44): the scene's DM-placed kept templates, or (`players: true`)
 * every kept one.
 */
export const TemplatesCleared = defineEvent({
  type: "TemplatesCleared",
  payload: z
    .object({ sceneId: z.string(), templateIds: z.array(z.string()), players: z.boolean() })
    .strict(),
  ...logged,
});

/** `scn.setDiagonalRule` (FR-SCN-29). */
export const DiagonalRuleSet = defineEvent({
  type: "DiagonalRuleSet",
  payload: z.object({ rule: DiagonalRule }).strict(),
  ...logged,
});
