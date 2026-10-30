// Domain events of overview scenes (OVW §9, protocol §190). All logged except
// `OverviewItemsMoved`, as `TokenMoved`; none is undoable.
import { z } from "zod";
import { defineEvent } from "./types";

const logged = <P extends z.ZodType>(type: string, payload: P) =>
  defineEvent({ type, payload, logged: true, undoable: false });

const overviewPayload = z.object({ overviewId: z.string() }).strict();
const itemsPayload = z.object({ overviewId: z.string(), itemIds: z.array(z.string()) }).strict();

export const OverviewCreated = logged("OverviewCreated", overviewPayload);
export const OverviewUpdated = logged("OverviewUpdated", overviewPayload);
export const OverviewDuplicated = logged("OverviewDuplicated", overviewPayload);
export const OverviewDeleted = logged("OverviewDeleted", overviewPayload);
/** FR-OVW-05: DM by `changes`, players by resync. */
export const OverviewShown = logged(
  "OverviewShown",
  z
    .object({
      overviewId: z.string(),
      previousSceneId: z.string().nullable(),
      previousOverviewId: z.string().nullable(),
    })
    .strict(),
);
export const OverviewItemsPlaced = logged("OverviewItemsPlaced", itemsPayload);
export const OverviewItemsUpdated = logged("OverviewItemsUpdated", itemsPayload);
export const OverviewItemsDeleted = logged("OverviewItemsDeleted", itemsPayload);
/** FR-OVW-17: not logged. */
export const OverviewItemsMoved = defineEvent({
  type: "OverviewItemsMoved",
  payload: itemsPayload,
  logged: false,
  undoable: false,
});
