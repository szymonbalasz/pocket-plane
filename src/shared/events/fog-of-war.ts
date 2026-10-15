// Domain events of fog-of-war (FOG §9, protocol §16). Both logged; not ADR-0016-undoable (fog
// has its own per-scene stack, FR-FOG-07). Changes: the `fog` upsert, every subject whose
// `fogged` flips, `scene-structure` door flags and token-changed hook rows (FR-FOG-08).
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
