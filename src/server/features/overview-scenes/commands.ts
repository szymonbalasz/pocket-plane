// Overview commands (OVW §6.1, FR-OVW-01–06; protocol §190): DM-only WS intents. Each is one
// transaction: validate → write → one event-log entry → one event. IDs and time from ctx.
import {
  OverviewCreated,
  OverviewDeleted,
  OverviewDuplicated,
  OverviewShown,
  OverviewUpdated,
} from "@shared/events/overview-scenes";
import {
  CreateOverviewInput,
  ITEMS_PER_CAMPAIGN_MAX,
  OVERVIEWS_PER_CAMPAIGN_MAX,
  OVW_INTENTS,
  OverviewIdInput,
  UpdateOverviewInput,
} from "@shared/overview-scenes/schemas";
import { copyName } from "@shared/scenes-map/geometry";
import { SCENE_TYPE } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import {
  overview,
  overviewItem,
  overviewItemSeqNext,
  overviewSeqNext,
  scene,
} from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { activeSceneOf, campaignOf, getFolder, readScene } from "../scenes-map/rows";
import { lifecycleHooks } from "../scenes-map/scene-hooks";
import {
  countItems,
  countOverviews,
  getOverview,
  itemChange,
  itemsOf,
  overviewChange,
  readItem,
  readOverview,
  shownOverviewOf,
} from "./rows";

/** FR-OVW-04, as FR-MAP-05. */
export const SHOWN_NO_DELETE = "Show something else first";

const OVERVIEW_CAP = `A campaign holds at most ${OVERVIEWS_PER_CAMPAIGN_MAX} overviews`;

/** FR-OVW-01: not shown; no map, grid or fog. */
export const createOverview = defineCommand({
  name: OVW_INTENTS.create,
  input: CreateOverviewInput,
  execute(input, { tx, ctx, actor, emit }): { overviewId: string } {
    const cid = campaignOf(actor);
    if (countOverviews(tx, cid) + 1 > OVERVIEWS_PER_CAMPAIGN_MAX) throw conflict(OVERVIEW_CAP);
    const folderId = input.folderId ? getFolder(tx, cid, input.folderId).id : null;
    const id = ctx.ids.next();
    const now = ctx.clock.iso();
    tx.insert(overview)
      .values({
        id,
        campaignId: cid,
        folderId,
        seq: overviewSeqNext,
        name: input.name,
        active: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    emit({
      type: OverviewCreated.type,
      campaignId: cid,
      payload: { overviewId: id },
      changes: [overviewChange(null, readOverview(tx, id))],
    });
    return { overviewId: id };
  },
});

/** FR-OVW-02: rename, move to a folder or the root. No change → no event. */
export const updateOverview = defineCommand({
  name: OVW_INTENTS.update,
  input: UpdateOverviewInput,
  execute(input, { tx, ctx, actor, emit }): void {
    const cid = campaignOf(actor);
    const before = getOverview(tx, cid, input.overviewId);
    const set: Partial<typeof overview.$inferInsert> = {};
    if (input.name !== undefined && input.name !== before.name) set.name = input.name;
    if (input.folderId !== undefined && input.folderId !== before.folderId) {
      set.folderId = input.folderId === null ? null : getFolder(tx, cid, input.folderId).id;
    }
    if (Object.keys(set).length === 0) return;
    tx.update(overview)
      .set({ ...set, updatedAt: ctx.clock.iso() })
      .where(eq(overview.id, before.id))
      .run();
    emit({
      type: OverviewUpdated.type,
      campaignId: cid,
      payload: { overviewId: before.id },
      changes: [overviewChange(before, readOverview(tx, before.id))],
    });
  },
});

/** FR-OVW-03: "‹name› (copy)" cut to 60, same folder, not shown, every item copied. */
export const duplicateOverview = defineCommand({
  name: OVW_INTENTS.duplicate,
  input: OverviewIdInput,
  execute({ overviewId }, { tx, ctx, actor, emit }): { overviewId: string } {
    const cid = campaignOf(actor);
    const src = getOverview(tx, cid, overviewId);
    if (countOverviews(tx, cid) + 1 > OVERVIEWS_PER_CAMPAIGN_MAX) throw conflict(OVERVIEW_CAP);
    const items = itemsOf(tx, src.id);
    if (countItems(tx, { campaignId: cid }) + items.length > ITEMS_PER_CAMPAIGN_MAX) {
      throw conflict(`A campaign holds at most ${ITEMS_PER_CAMPAIGN_MAX} overview items`);
    }
    const id = ctx.ids.next();
    const now = ctx.clock.iso();
    tx.insert(overview)
      .values({
        id,
        campaignId: cid,
        folderId: src.folderId,
        seq: overviewSeqNext,
        name: copyName(src.name),
        active: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const changes: RecordChange[] = [overviewChange(null, readOverview(tx, id))];
    for (const { seq: _seq, ...item } of items) {
      const itemId = ctx.ids.next();
      tx.insert(overviewItem)
        .values({
          ...item,
          id: itemId,
          overviewId: id,
          seq: overviewItemSeqNext,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      changes.push(itemChange(null, readItem(tx, itemId)));
    }
    emit({
      type: OverviewDuplicated.type,
      campaignId: cid,
      payload: { overviewId: id },
      changes,
    });
    return { overviewId: id };
  },
});

/** FR-OVW-04: items go with it. A shown overview → `conflict`. */
export const deleteOverview = defineCommand({
  name: OVW_INTENTS.delete,
  input: OverviewIdInput,
  execute({ overviewId }, { tx, actor, emit }): void {
    const cid = campaignOf(actor);
    const before = getOverview(tx, cid, overviewId);
    if (before.active) throw conflict(SHOWN_NO_DELETE);
    const items = itemsOf(tx, overviewId);
    tx.delete(overviewItem).where(eq(overviewItem.overviewId, overviewId)).run();
    tx.delete(overview).where(eq(overview.id, overviewId)).run();
    emit({
      type: OverviewDeleted.type,
      campaignId: cid,
      payload: { overviewId },
      changes: [...items.map((i) => itemChange(i, null)), overviewChange(before, null)],
    });
  },
});

/**
 * FR-OVW-05: one transaction: the active scene off, the shown overview off, target on, then
 * `sceneHooks.deactivated` for the scene that went off. Already shown → no event.
 */
export const showOverview = defineCommand({
  name: OVW_INTENTS.show,
  input: OverviewIdInput,
  execute({ overviewId }, { tx, ctx, actor, emit }): void {
    const cid = campaignOf(actor);
    const target = getOverview(tx, cid, overviewId);
    if (target.active) return;
    const prevScene = activeSceneOf(tx, cid);
    const prevOverview = shownOverviewOf(tx, cid);
    const now = ctx.clock.iso();
    const changes: RecordChange[] = [];
    if (prevScene) {
      tx.update(scene)
        .set({ active: false, updatedAt: now })
        .where(eq(scene.id, prevScene.id))
        .run();
      changes.push({
        type: SCENE_TYPE,
        id: prevScene.id,
        before: prevScene,
        after: readScene(tx, prevScene.id),
      });
    }
    if (prevOverview) {
      tx.update(overview)
        .set({ active: false, updatedAt: now })
        .where(eq(overview.id, prevOverview.id))
        .run();
      changes.push(overviewChange(prevOverview, readOverview(tx, prevOverview.id)));
    }
    tx.update(overview)
      .set({ active: true, updatedAt: now })
      .where(eq(overview.id, overviewId))
      .run();
    changes.push(overviewChange(target, readOverview(tx, overviewId)));
    if (prevScene) {
      changes.push(...lifecycleHooks.deactivated({ tx, ctx, actor }, readScene(tx, prevScene.id)));
    }
    emit({
      type: OverviewShown.type,
      campaignId: cid,
      payload: {
        overviewId,
        previousSceneId: prevScene?.id ?? null,
        previousOverviewId: prevOverview?.id ?? null,
      },
      changes,
    });
  },
});
