// Domain events of fog-of-war (FOG §9, protocol §16). All logged; not ADR-0016-undoable (fog
// has its own per-scene stack, FR-FOG-07). Changes: the `fog` upsert, every subject whose
// copies change, `scene-structure` door flags, `vision` / `fog-explored` rows and token-changed
// hook rows (FR-FOG-08, -35). FOG v2 events (darkness, explored, Invisible) are declared in V0;
// their commands land in V1 / V2.
import { FogEditKind, FogShape } from "@shared/fog-of-war/schemas";
import { z } from "zod";
import { defineEvent } from "./types";

/** `fog.edit` / `fog.setAll`; `shape` only on rect / polygon edits. */
export const FogEdited = defineEvent({
  type: "FogEdited",
  payload: z
    .object({
      sceneId: z.string(),
      editId: z.string(),
      kind: FogEditKind,
      shape: FogShape.optional(),
    })
    .strict(),
  logged: true,
  undoable: false,
});

/** `fog.undo`: `editId` = the undo entry that was dropped. */
export const FogUndone = defineEvent({
  type: "FogUndone",
  payload: z.object({ sceneId: z.string(), editId: z.string() }).strict(),
  logged: true,
  undoable: false,
});

/** FR-FOG-30: darkness intents; `darknessId` absent on `DarknessCleared`. */
const DarknessPayload = z
  .object({ sceneId: z.string(), editId: z.string(), darknessId: z.string().optional() })
  .strict();

export const DarknessPlaced = defineEvent({
  type: "DarknessPlaced",
  payload: DarknessPayload,
  logged: true,
  undoable: false,
});

export const DarknessMoved = defineEvent({
  type: "DarknessMoved",
  payload: DarknessPayload,
  logged: true,
  undoable: false,
});

export const DarknessRemoved = defineEvent({
  type: "DarknessRemoved",
  payload: DarknessPayload,
  logged: true,
  undoable: false,
});

export const DarknessCleared = defineEvent({
  type: "DarknessCleared",
  payload: DarknessPayload,
  logged: true,
  undoable: false,
});

/** FR-FOG-29: `fog.setExplored`. */
export const FogExploredSet = defineEvent({
  type: "FogExploredSet",
  payload: z.object({ sceneId: z.string(), on: z.boolean() }).strict(),
  logged: true,
  undoable: false,
});

/** FR-FOG-31: `fog.forgetExplored` (every `fog-explored` row of the scene deleted). */
export const ExploredForgotten = defineEvent({
  type: "ExploredForgotten",
  payload: z.object({ sceneId: z.string() }).strict(),
  logged: true,
  undoable: false,
});

/** FR-FOG-45 (#210): `fog.setInvisible`. */
export const TokenInvisibleSet = defineEvent({
  type: "TokenInvisibleSet",
  payload: z.object({ sceneId: z.string(), tokenId: z.string(), invisible: z.boolean() }).strict(),
  logged: true,
  undoable: false,
});
