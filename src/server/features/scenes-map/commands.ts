// scenes-map commands (MAP §6, §9; protocol §13, §16). Each: validated intent → rows + event-log
// entry in one transaction (except `TokenMoved`, not logged) → domain event. IDs and time from ctx;
// `seq` from the DB (CON-20). Campaign = `actor.campaignId`, fixed at authentication (CON-21).
import { creatureTypeOf } from "@shared/entities/schemas";
import {
  SceneActivated,
  SceneCreated,
  SceneDeleted,
  SceneDuplicated,
  SceneFolderCreated,
  SceneFolderDeleted,
  SceneFolderRenamed,
  SceneListMoved,
  SceneUpdated,
  TokenDeleted,
  TokenDuplicated,
  TokenHidden,
  TokenMoved,
  TokenPlaced,
  TokenRevealed,
  TokenUpdated,
} from "@shared/events/scenes-map";
import { copyName, duplicateCell, numberedName, overlapsMap } from "@shared/scenes-map/geometry";
import {
  canMoveFolder,
  canNestIn,
  FOLDER_DEPTH_MAX,
  folderSubtree,
} from "@shared/scenes-map/list-tree";
import {
  ActivateSceneInput,
  CheckMoveInput,
  type CheckMoveResult,
  CreateFolderBody,
  CreateSceneBody,
  GRID_DEFAULTS,
  MAP_INTENTS,
  MoveListEntryBody,
  MoveTokenInput,
  PlaceTokenInput,
  SceneFolderBody,
  type SceneFolderRecord,
  SceneName,
  type SceneRecord,
  SetGridInput,
  SetLockedInput,
  SetSceneMapInput,
  SetTokenHiddenInput,
  TOKEN_TYPE,
  TOKENS_PER_CAMPAIGN_MAX,
  TOKENS_PER_SCENE_MAX,
  TokenIdInput,
  type TokenRecord,
  type TokenSize,
  UpdateTokenInput,
} from "@shared/scenes-map/schemas";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandEnv, defineCommand, IdSchema } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import {
  player,
  scene,
  sceneFolder,
  sceneFolderSeqNext,
  sceneSeqNext,
  token,
  tokenSeqNext,
} from "../../db/schema";
import type { Actor, RecordChange } from "../../events/types";
import { requireAsset } from "../assets-pipeline/commands";
import { importedArtOfDefinition } from "../compendium/imported-art-lookup";
import { resolveDefinition } from "../entities/commands";
import { getOverview } from "../overview-scenes/rows";
import { characterIdOf } from "./character-copy";
import { entriesIn, nextPosition, placeEntries } from "./list-order";
import { tokenMoveGuards } from "./move-guards";
import {
  activeSceneOf,
  campaignOf,
  countTokens,
  findScene,
  folderChange,
  folderRecords,
  getFolder,
  getScene,
  getToken,
  readFolder,
  readScene,
  readToken,
  sceneChange,
  sceneTokens,
} from "./rows";
import { lifecycleHooks } from "./scene-hooks";
import { runTokenChangedHooks, type TokenHooks } from "./token-hooks";
import { tokenCopies } from "./token-owner";
import { rederiveDependants, tokenHiddenFor } from "./visibility-hooks";

/** REST-only commands (no WS intent, MAP §9 / ADR-0021 D). */
export const MAP_REST = {
  createScene: "map.createScene",
  updateScene: "map.updateScene",
  duplicateScene: "map.duplicateScene",
  deleteScene: "map.deleteScene",
  createFolder: "map.createFolder",
  renameFolder: "map.renameFolder",
  deleteFolder: "map.deleteFolder",
  moveListEntry: "map.moveListEntry",
} as const;

const tokenChange = (before: TokenRecord | null, after: TokenRecord | null): RecordChange => ({
  type: TOKEN_TYPE,
  id: (after ?? before)?.id as string,
  before,
  after,
});

/** FR-MAP-13 / -18: owner must be a player of the campaign. */
function assertOwner(tx: Tx, cid: string, ownerPlayerId: string) {
  const row = tx
    .select({ id: player.id })
    .from(player)
    .where(and(eq(player.id, ownerPlayerId), eq(player.campaignId, cid)))
    .get();
  if (!row) {
    throw invalid("Owner must be a player of this campaign", [
      { path: ["ownerPlayerId"], message: "Not a player of this campaign" },
    ]);
  }
}

/** FR-MAP-14: the footprint overlaps the map, else `invalid`. */
function assertOnMap(s: SceneRecord, col: number, row: number, size: TokenSize) {
  if (!overlapsMap(s, col, row, size)) {
    throw invalid("Token must overlap the map", [{ path: ["col"], message: "Off the map" }]);
  }
}

/** FR-MAP-14 caps *(proposed, OQ-MAP-20)*. */
function assertCaps(tx: Tx, cid: string, sceneId: string, adding: number) {
  if (countTokens(tx, { sceneId }) + adding > TOKENS_PER_SCENE_MAX) {
    throw conflict(`A scene holds at most ${TOKENS_PER_SCENE_MAX} tokens`);
  }
  if (countTokens(tx, { campaignId: cid }) + adding > TOKENS_PER_CAMPAIGN_MAX) {
    throw conflict(`A campaign holds at most ${TOKENS_PER_CAMPAIGN_MAX} tokens`);
  }
}

function assertUnlocked(s: SceneRecord) {
  if (s.mapLocked) throw conflict("The map is locked");
}

const assetOrNull = (env: CommandEnv, id: string | null | undefined): string | null =>
  id === null || id === undefined ? null : requireAsset(env, id).id;

// ---------- scenes (REST) ----------

/** FR-MAP-01: inactive, unlocked, grid defaults; map size = the asset's `display` size. */
export const createScene = defineCommand({
  name: MAP_REST.createScene,
  input: CreateSceneBody,
  execute(input, env): SceneRecord {
    const { tx, ctx, actor, emit } = env;
    const cid = campaignOf(actor);
    const map = requireAsset(env, input.mapAssetId);
    const folderId = input.folderId ? getFolder(tx, cid, input.folderId).id : null;
    const id = ctx.ids.next();
    const now = ctx.clock.iso();
    tx.insert(scene)
      .values({
        id,
        campaignId: cid,
        folderId,
        position: nextPosition(tx, cid, folderId),
        seq: sceneSeqNext,
        name: input.name,
        mapAssetId: map.id,
        mapWidth: map.displayWidth,
        mapHeight: map.displayHeight,
        gridCellSize: GRID_DEFAULTS.cellSize,
        gridOffsetX: GRID_DEFAULTS.offsetX,
        gridOffsetY: GRID_DEFAULTS.offsetY,
        gridVisible: GRID_DEFAULTS.visible,
        gridColor: GRID_DEFAULTS.color,
        gridOpacity: GRID_DEFAULTS.opacity,
        mapLocked: false,
        active: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const after = readScene(tx, id);
    // ADR-0039: scene lifecycle hooks (fog: the new scene's fog row) join the event.
    const hookChanges = lifecycleHooks.created({ tx, ctx, actor }, after);
    emit({
      type: SceneCreated.type,
      campaignId: cid,
      payload: { sceneId: id },
      changes: [sceneChange(null, after), ...hookChanges],
    });
    return after;
  },
});

/** Updates scene columns and emits `SceneUpdated` (CON-31). */
function updateScene(
  env: CommandEnv,
  before: SceneRecord,
  set: Partial<typeof scene.$inferInsert>,
): SceneRecord {
  const { tx, ctx, actor, emit } = env;
  tx.update(scene)
    .set({ ...set, updatedAt: ctx.clock.iso() })
    .where(eq(scene.id, before.id))
    .run();
  const after = readScene(tx, before.id);
  // Review A8 (FR-FOG-33): the map rectangle bounds sight, so a moved rectangle runs `mapChanged`.
  const hooks = mapRectMoved(before, after)
    ? lifecycleHooks.mapChanged({ tx, ctx, actor }, after)
    : [];
  emit({
    type: SceneUpdated.type,
    campaignId: before.campaignId,
    payload: { sceneId: before.id },
    changes: [sceneChange(before, after), ...hooks],
  });
  return after;
}

/** The map rectangle (image size, cell size, offsets) differs. */
const mapRectMoved = (a: SceneRecord, b: SceneRecord) =>
  a.mapWidth !== b.mapWidth ||
  a.mapHeight !== b.mapHeight ||
  a.gridCellSize !== b.gridCellSize ||
  a.gridOffsetX !== b.gridOffsetX ||
  a.gridOffsetY !== b.gridOffsetY;

/** PATCH body (`PatchSceneBody`) + the path id. */
export const UpdateSceneInput = z.strictObject({
  id: IdSchema,
  name: SceneName.optional(),
  folderId: IdSchema.nullable().optional(),
});

/** FR-MAP-03: rename and/or move into a folder / to the root. */
export const patchScene = defineCommand({
  name: MAP_REST.updateScene,
  input: UpdateSceneInput,
  execute(input, env): SceneRecord {
    const cid = campaignOf(env.actor);
    const before = getScene(env.tx, cid, input.id);
    const set: Partial<typeof scene.$inferInsert> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.folderId !== undefined && input.folderId !== before.folderId) {
      set.folderId = input.folderId === null ? null : getFolder(env.tx, cid, input.folderId).id;
      set.position = nextPosition(env.tx, cid, set.folderId);
    }
    return updateScene(env, before, set);
  },
});

/**
 * FR-MAP-04: inactive copy "‹name› (copy)", same folder/map/grid/lock, every token copied.
 * ADR-0039: the lifecycle hooks run after the copy's insert and before its tokens, whose
 * `fogged` is derived against the copy (FR-FOG-10).
 */
export const duplicateScene = defineCommand({
  name: MAP_REST.duplicateScene,
  input: z.strictObject({ id: IdSchema }),
  execute({ id: sourceId }, env): SceneRecord {
    const { tx, ctx, actor, emit } = env;
    const cid = campaignOf(actor);
    const src = getScene(tx, cid, sourceId);
    const tokens = sceneTokens(tx, src.id);
    if (countTokens(tx, { campaignId: cid }) + tokens.length > TOKENS_PER_CAMPAIGN_MAX) {
      throw conflict(`A campaign holds at most ${TOKENS_PER_CAMPAIGN_MAX} tokens`);
    }
    const id = ctx.ids.next();
    const now = ctx.clock.iso();
    const { seq: _seq, ...rest } = src;
    tx.insert(scene)
      .values({
        ...rest,
        id,
        position: nextPosition(tx, cid, src.folderId),
        seq: sceneSeqNext,
        name: copyName(src.name),
        active: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const copy = readScene(tx, id);
    const changes: RecordChange[] = [
      sceneChange(null, copy),
      ...lifecycleHooks.duplicated({ tx, ctx, actor }, src, copy),
    ];
    for (const t of tokens) {
      const tid = ctx.ids.next();
      const { seq: _s, ...fields } = t;
      tx.insert(token)
        .values({
          ...fields,
          id: tid,
          sceneId: id,
          seq: tokenSeqNext,
          ...tokenCopies(tx, { ...t, sceneId: id }),
          // FR-MAP-65: a trail lives on the started encounter's scene only.
          trail: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      changes.push(tokenChange(null, readToken(tx, tid)));
    }
    // FR-FOG-35 (#216): the copy re-derives once its tokens are copied; rows fold into creates.
    for (const d of rederiveDependants({ tx, ctx, actor }, sceneChange(null, copy))) {
      const c = changes.find((x) => x.type === d.type && x.id === d.id);
      if (c) c.after = d.after;
      else changes.push(d);
    }
    emit({
      type: SceneDuplicated.type,
      campaignId: cid,
      payload: { sceneId: id, sourceSceneId: src.id },
      changes,
    });
    return readScene(tx, id);
  },
});

/**
 * FR-MAP-05: non-active only; tokens go with it, each through the token-changed hooks first.
 * ADR-0039: the lifecycle hooks' `deleting` runs before any row is deleted (fog: the `fog`
 * delete); the FK cascade removes the dependent rows.
 */
export function deleteSceneCommand(hooks: TokenHooks) {
  return defineCommand({
    name: MAP_REST.deleteScene,
    input: z.strictObject({ id: IdSchema }),
    execute({ id }, env): void {
      const { tx, ctx, actor, emit } = env;
      const cid = campaignOf(actor);
      const before = getScene(tx, cid, id);
      if (before.active) throw conflict("The scene shown to players can't be deleted");
      const sceneHookChanges = lifecycleHooks.deleting({ tx, ctx, actor }, before);
      const tokens = sceneTokens(tx, id);
      const changes: RecordChange[] = [];
      for (const t of tokens) changes.push(...hooks.run({ tx, ctx, actor }, t, null));
      tx.delete(token).where(eq(token.sceneId, id)).run();
      tx.delete(scene).where(eq(scene.id, id)).run();
      emit({
        type: SceneDeleted.type,
        campaignId: cid,
        payload: { sceneId: id },
        changes: [
          ...tokens.map((t) => tokenChange(t, null)),
          ...changes,
          ...sceneHookChanges,
          sceneChange(before, null),
        ],
      });
    },
  });
}

// ---------- folders (REST, FR-MAP-02) ----------

const TOO_DEEP = `Folders nest at most ${FOLDER_DEPTH_MAX} levels`;

export const createFolder = defineCommand({
  name: MAP_REST.createFolder,
  input: CreateFolderBody,
  execute({ name, parentId }, { tx, ctx, actor, emit }): SceneFolderRecord {
    const cid = campaignOf(actor);
    const parent = parentId ? getFolder(tx, cid, parentId).id : null;
    if (!canNestIn(folderRecords(tx, cid), parent)) throw conflict(TOO_DEEP);
    const id = ctx.ids.next();
    const now = ctx.clock.iso();
    tx.insert(sceneFolder)
      .values({
        id,
        campaignId: cid,
        parentId: parent,
        position: nextPosition(tx, cid, parent),
        seq: sceneFolderSeqNext,
        name,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const after = readFolder(tx, id);
    emit({
      type: SceneFolderCreated.type,
      campaignId: cid,
      payload: { folderId: id },
      changes: [folderChange(null, after)],
    });
    return after;
  },
});

export const renameFolder = defineCommand({
  name: MAP_REST.renameFolder,
  input: SceneFolderBody.extend({ id: IdSchema }),
  execute({ id, name }, { tx, ctx, actor, emit }): SceneFolderRecord {
    const cid = campaignOf(actor);
    const before = getFolder(tx, cid, id);
    tx.update(sceneFolder)
      .set({ name, updatedAt: ctx.clock.iso() })
      .where(eq(sceneFolder.id, id))
      .run();
    const after = readFolder(tx, id);
    emit({
      type: SceneFolderRenamed.type,
      campaignId: cid,
      payload: { folderId: id },
      changes: [folderChange(before, after)],
    });
    return after;
  },
});

/**
 * FR-MAP-02: a folder delete moves its contents (scenes, overviews per FR-OVW-02, subfolders) up to
 * its parent, in its place, in the same transaction.
 */
export const deleteFolder = defineCommand({
  name: MAP_REST.deleteFolder,
  input: z.strictObject({ id: IdSchema }),
  execute({ id }, env): void {
    const { tx, actor, emit } = env;
    const cid = campaignOf(actor);
    const before = getFolder(tx, cid, id);
    const contents = entriesIn(tx, cid, id);
    const level = entriesIn(tx, cid, before.parentId).flatMap((e) =>
      e.id === id ? contents : [e],
    );
    const arranged = level.some((e) => e.position !== 0);
    const changes = placeEntries(env, level, before.parentId, arranged);
    tx.delete(sceneFolder).where(eq(sceneFolder.id, id)).run();
    emit({
      type: SceneFolderDeleted.type,
      campaignId: cid,
      payload: { folderId: id },
      changes: [...changes, folderChange(before, null)],
    });
  },
});

/**
 * FR-MAP-116: moves a scene, overview or folder into `parentId` before `beforeId`, and numbers that
 * level. The spot it already holds → no event. FR-MAP-02: a folder never goes into itself or below
 * the depth cap.
 */
export const moveListEntry = defineCommand({
  name: MAP_REST.moveListEntry,
  input: MoveListEntryBody,
  execute({ kind, id, parentId, beforeId }, env): void {
    const { tx, actor, emit } = env;
    const cid = campaignOf(actor);
    const from =
      kind === "scene"
        ? getScene(tx, cid, id).folderId
        : kind === "overview"
          ? getOverview(tx, cid, id).folderId
          : getFolder(tx, cid, id).parentId;
    if (parentId !== null) getFolder(tx, cid, parentId);
    if (kind === "folder") {
      const folders = folderRecords(tx, cid);
      if (parentId !== null && folderSubtree(folders, id).has(parentId)) {
        throw conflict("A folder can't go inside itself");
      }
      if (!canMoveFolder(folders, id, parentId)) throw conflict(TOO_DEEP);
    }
    const moved = entriesIn(tx, cid, from).find((e) => e.id === id);
    if (!moved) throw notFound("Entry not found");
    const target = entriesIn(tx, cid, parentId);
    const others = target.filter((e) => e.id !== id);
    const at = beforeId === null ? others.length : others.findIndex((e) => e.id === beforeId);
    if (at < 0) throw conflict("The scene list changed; try again");
    const level = [...others.slice(0, at), moved, ...others.slice(at)];
    if (from === parentId && level.every((e, i) => e.id === target[i]?.id)) return;
    emit({
      type: SceneListMoved.type,
      campaignId: cid,
      payload: { kind, id },
      changes: placeEntries(env, level, parentId, true),
    });
  },
});

// ---------- scene intents (WS, DM) ----------

/**
 * FR-MAP-06: ≤ 1 active scene; one transaction flips both flags. Already active → no event.
 * ADR-0042: the lifecycle hooks' `activated` runs after the flip (fog re-derives a stale scene,
 * FR-FOG-35); its rows join `SceneActivated`.
 */
export const activateScene = defineCommand({
  name: MAP_INTENTS.activateScene,
  input: ActivateSceneInput,
  execute({ sceneId }, { tx, ctx, actor, emit }): void {
    const cid = campaignOf(actor);
    const target = getScene(tx, cid, sceneId);
    if (target.active) return;
    const prev = activeSceneOf(tx, cid);
    const now = ctx.clock.iso();
    const changes: RecordChange[] = [];
    if (prev) {
      tx.update(scene).set({ active: false, updatedAt: now }).where(eq(scene.id, prev.id)).run();
      changes.push(sceneChange(prev, readScene(tx, prev.id)));
    }
    tx.update(scene).set({ active: true, updatedAt: now }).where(eq(scene.id, sceneId)).run();
    const after = readScene(tx, sceneId);
    changes.push(sceneChange(target, after));
    changes.push(...lifecycleHooks.activated({ tx, ctx, actor }, after));
    emit({
      type: SceneActivated.type,
      campaignId: cid,
      payload: { sceneId, previousSceneId: prev?.id ?? null },
      changes,
    });
  },
});

/** FR-MAP-09: replaces the map and its stored size; tokens keep their cells. */
export const setSceneMap = defineCommand({
  name: MAP_INTENTS.setSceneMap,
  input: SetSceneMapInput,
  execute({ sceneId, mapAssetId }, env): void {
    const before = getScene(env.tx, campaignOf(env.actor), sceneId);
    assertUnlocked(before);
    const map = requireAsset(env, mapAssetId);
    updateScene(env, before, {
      mapAssetId: map.id,
      mapWidth: map.displayWidth,
      mapHeight: map.displayHeight,
    });
  },
});

/** FR-MAP-10. */
export const setGrid = defineCommand({
  name: MAP_INTENTS.setGrid,
  input: SetGridInput,
  execute(g, env): void {
    const before = getScene(env.tx, campaignOf(env.actor), g.sceneId);
    assertUnlocked(before);
    updateScene(env, before, {
      gridCellSize: g.cellSize,
      gridOffsetX: g.offsetX,
      gridOffsetY: g.offsetY,
      gridVisible: g.visible,
      gridColor: g.color,
      gridOpacity: g.opacity,
    });
  },
});

/** FR-MAP-11. */
export const setLocked = defineCommand({
  name: MAP_INTENTS.setLocked,
  input: SetLockedInput,
  execute({ sceneId, locked }, env): void {
    const before = getScene(env.tx, campaignOf(env.actor), sceneId);
    if (before.mapLocked === locked) return;
    updateScene(env, before, { mapLocked: locked });
  },
});

// ---------- token intents (WS) ----------

function insertToken(
  env: CommandEnv,
  fields: Omit<typeof token.$inferInsert, "id" | "seq" | "createdAt" | "updatedAt">,
): TokenRecord {
  const id = env.ctx.ids.next();
  const now = env.ctx.clock.iso();
  env.tx
    .insert(token)
    .values({ ...fields, id, seq: tokenSeqNext, createdAt: now, updatedAt: now })
    .run();
  return readToken(env.tx, id);
}

const namesOn = (tx: Tx, sceneId: string) => sceneTokens(tx, sceneId).map((t) => t.name);

/** `placeTokenIn`'s input: `map.placeToken`'s fields (FR-MAP-48 callers pass the first six). */
export type PlaceTokenSpec = z.output<typeof PlaceTokenInput>;

/**
 * FR-MAP-48: `map.placeToken` minus intent and event, for other commands (combat's Start and
 * add, FR-CBT-65 / FR-CBTX-44). Same rules, in the **caller's** transaction: FR-MAP-14 validity
 * (`invalid`) and caps (`conflict`) fail the caller's command. The caller lists `change` in its
 * own event. Runs no token-changed hooks (placement never does, FR-MAP-30).
 *
 * FR-MAP-13: name = definition name, numbered (FR-MAP-16); image = the one given, else portrait;
 * none of those (a given `null` included) → the campaign's imported art (FR-CMPX-24), or none; size =
 * `statBlock.size`; shape = definition `tokenShape`, else round (FR-MAP-35); speed =
 * `statBlock.speed`, else null (FR-MAP-36); `creatureType` = the monster's `statBlock.type`, else
 * null (FR-ENT-27); owner = the character's or (FR-MAP-74, sprint 6) the pet's owner, else none;
 * visible; `characterId` copy (FR-MAP-50); `fogged` / `seenBy` derived (FR-FOG-10). Optional
 * overrides (fixtures) for name, image, owner, hidden, shape; never size, speed,
 * `creatureType`, `characterId` or `fogged`.
 * `dependants` = the visibility hooks' `rederive` rows (FR-FOG-35, ADR-0042); a caller lists them
 * after `change` in its event (none until vision sources exist, V2).
 */
export function placeTokenIn(
  env: CommandEnv,
  input: PlaceTokenSpec,
): { token: TokenRecord; change: RecordChange; dependants: RecordChange[] } {
  const { tx, actor } = env;
  const cid = campaignOf(actor);
  const s = getScene(tx, cid, input.sceneId);
  const def = resolveDefinition(env, input.definitionId);
  const size = def.statBlock.size;
  assertOnMap(s, input.col, input.row, size);
  assertCaps(tx, cid, s.id, 1);
  // FR-MAP-74 (sprint 6): a character's or a pet's token takes its owner (imported: none).
  let ownerPlayerId: string | null = def.ownerPlayerId;
  if (input.ownerPlayerId !== undefined) {
    if (input.ownerPlayerId !== null) assertOwner(tx, cid, input.ownerPlayerId);
    ownerPlayerId = input.ownerPlayerId;
  }
  const imageAssetId =
    (input.imageAssetId !== undefined
      ? assetOrNull(env, input.imageAssetId)
      : assetOrNull(env, def.portraitAssetId)) ?? importedArtOfDefinition(tx, cid, def.id);
  const after = insertToken(env, {
    campaignId: cid,
    sceneId: s.id,
    definitionId: def.id,
    name: numberedName(input.name ?? def.name, namesOn(tx, s.id)),
    imageAssetId,
    size,
    shape: input.shape ?? def.tokenShape ?? "round",
    creatureType: creatureTypeOf(def),
    speed: def.statBlock.speed ?? null,
    col: input.col,
    row: input.row,
    ownerPlayerId,
    hidden: input.hidden ?? false,
    characterId: characterIdOf(def),
    ...tokenCopies(tx, { sceneId: s.id, col: input.col, row: input.row, size, ownerPlayerId }),
  });
  const dependants = rederiveDependants(env, tokenChange(null, after));
  return { token: after, change: tokenChange(null, after), dependants };
}

/**
 * FR-MAP-79 (sprint 6): deletes a token inside the caller's transaction (combat: a summon's token
 * at Dismiss / End, after its combatant went inactive). Token-changed hooks first (they may
 * refuse, as `map.deleteToken`), then the row, then its dependants (fog, FR-FOG-35). Returns the
 * `token` delete + the hook and dependant rows for the caller's event.
 */
export function deleteTokenIn(env: CommandEnv, tokenId: string): RecordChange[] {
  const { tx, ctx, actor } = env;
  const before = getToken(tx, campaignOf(actor), tokenId);
  const hookChanges = runTokenChangedHooks({ tx, ctx, actor }, before, null);
  tx.delete(token).where(eq(token.id, tokenId)).run();
  const dependants = rederiveDependants({ tx, ctx, actor }, tokenChange(before, null));
  return [tokenChange(before, null), ...dependants, ...hookChanges];
}

/** FR-MAP-13: `placeTokenIn` + `TokenPlaced`. */
export const placeToken = defineCommand({
  name: MAP_INTENTS.placeToken,
  input: PlaceTokenInput,
  execute(input, env): { tokenId: string } {
    const { token: after, change, dependants } = placeTokenIn(env, input);
    env.emit({
      type: TokenPlaced.type,
      campaignId: after.campaignId,
      payload: { tokenId: after.id, sceneId: after.sceneId },
      changes: [change, ...dependants],
    });
    return { tokenId: after.id };
  },
});

/**
 * FR-MAP-21 / FR-FOG-11: a player may move (or check a move of) a token iff they own it, it is
 * on the active scene and they can see it. One they can't see (hidden, fog-hidden for them, on
 * another scene or unknown) answers `not_found`, checked first (no existence oracle); visible
 * but not theirs → `forbidden`. The DM may move any token on any scene.
 */
function authorizeTokenMove(tx: Tx, actor: Actor, tokenId: string): void {
  if (actor.role !== "player") return;
  const cid = campaignOf(actor);
  const t = getToken(tx, cid, tokenId);
  const active = activeSceneOf(tx, cid);
  if (active?.id !== t.sceneId || tokenHiddenFor(t, actor.playerId, cid)) {
    throw notFound("Token not found");
  }
  if (t.ownerPlayerId === null || t.ownerPlayerId !== actor.playerId) {
    throw forbidden("Not your token");
  }
}

/**
 * FR-MAP-21 (`authorizeTokenMove`). FR-MAP-38 (ADR-0031): runs the token-changed hooks in the
 * same transaction, possibly as a player actor; their rows ride on the unlogged `TokenMoved`.
 * Hooks never reject a move; a throw rolls it back (`internal`). Order (ADR-0040 / ADR-0042,
 * FR-FOG-10): validate → guards → `derive` (`fogged`, `seenBy`) → one write → re-derive
 * dependants → token-changed hooks, so a move into fog is already fogged in its own change
 * (players get one `delete`). FR-MAP-65 (sprint 5): the one `token` upsert is read after the
 * hooks, so it carries the trail combat's hook appended (no second upsert).
 */
export function moveTokenCommand(hooks: TokenHooks) {
  return defineCommand({
    name: MAP_INTENTS.moveToken,
    input: MoveTokenInput,
    roles: ["dm", "player"],
    authorize({ tokenId }, { tx, actor }) {
      authorizeTokenMove(tx, actor, tokenId);
    },
    execute({ tokenId, col, row }, env): void {
      const { tx, ctx, actor, emit } = env;
      const cid = campaignOf(actor);
      const before = getToken(tx, cid, tokenId);
      const s = findScene(tx, cid, before.sceneId) as SceneRecord;
      assertOnMap(s, col, row, before.size);
      // ADR-0040: guards (may refuse) → derive → one write → token-changed hooks.
      tokenMoveGuards.run(
        { read: tx, actor },
        before,
        { col: before.col, row: before.row },
        { col, row },
      );
      const copies = tokenCopies(tx, { ...before, col, row });
      tx.update(token)
        .set({ col, row, ...copies, updatedAt: ctx.clock.iso() })
        .where(eq(token.id, tokenId))
        .run();
      const after = readToken(tx, tokenId);
      const dependants = rederiveDependants({ tx, ctx, actor }, tokenChange(before, after));
      const hookChanges = hooks.run({ tx, ctx, actor }, before, after);
      emit({
        type: TokenMoved.type,
        campaignId: cid,
        payload: { tokenId, sceneId: before.sceneId, col, row },
        changes: [tokenChange(before, readToken(tx, tokenId)), ...dependants, ...hookChanges],
      });
    },
  });
}

/**
 * FR-SCN-38 (ADR-0042, OQ-SCN-26): `map.checkMove` = a read-only dry run of the move guards for
 * a previewed cell → `{ok, hints}`. Same authorization and errors as `map.moveToken` (FR-FOG-11:
 * a token the player can't see → `not_found`); not logged, no event, no `seq`, nothing written.
 */
export const checkMove = defineCommand({
  name: MAP_INTENTS.checkMove,
  input: CheckMoveInput,
  roles: ["dm", "player"],
  authorize({ tokenId }, { tx, actor }) {
    authorizeTokenMove(tx, actor, tokenId);
  },
  execute({ tokenId, col, row }, { tx, actor }): CheckMoveResult {
    const cid = campaignOf(actor);
    const t = getToken(tx, cid, tokenId);
    const s = findScene(tx, cid, t.sceneId) as SceneRecord;
    assertOnMap(s, col, row, t.size);
    // FR-FOG-53 (review A2): a DM drag of an owned token gates the hint phase on the owner's guards.
    const as =
      actor.role === "dm" && t.ownerPlayerId !== null
        ? { role: "player" as const, playerId: t.ownerPlayerId }
        : undefined;
    return tokenMoveGuards.check(
      { read: tx, actor },
      t,
      { col: t.col, row: t.row },
      { col, row },
      as ? { as } : {},
    );
  },
});

/** FR-MAP-18: rename, image (custom art), shape (FR-MAP-35), creature type (FR-ENT-27), owner;
 * never size or speed. Runs token-changed hooks. */
export function updateTokenCommand(hooks: TokenHooks) {
  return defineCommand({
    name: MAP_INTENTS.updateToken,
    input: UpdateTokenInput,
    execute(input, env): void {
      const { tx, ctx, actor, emit } = env;
      const cid = campaignOf(actor);
      const before = getToken(tx, cid, input.tokenId);
      const set: Partial<typeof token.$inferInsert> = {};
      if (input.name !== undefined) set.name = input.name;
      if (input.imageAssetId !== undefined) set.imageAssetId = assetOrNull(env, input.imageAssetId);
      if (input.ownerPlayerId !== undefined) {
        if (input.ownerPlayerId !== null) assertOwner(tx, cid, input.ownerPlayerId);
        set.ownerPlayerId = input.ownerPlayerId;
      }
      if (input.shape !== undefined) set.shape = input.shape;
      if (input.creatureType !== undefined) set.creatureType = input.creatureType;
      // FR-FOG-10 / -34: the owner decides the copies (owner + party rule).
      const copies =
        set.ownerPlayerId !== undefined && set.ownerPlayerId !== before.ownerPlayerId
          ? tokenCopies(tx, { ...before, ownerPlayerId: set.ownerPlayerId })
          : {};
      tx.update(token)
        .set({ ...set, ...copies, updatedAt: ctx.clock.iso() })
        .where(eq(token.id, before.id))
        .run();
      const after = readToken(tx, before.id);
      const dependants = rederiveDependants({ tx, ctx, actor }, tokenChange(before, after));
      const hookChanges = hooks.run({ tx, ctx, actor }, before, after);
      emit({
        type: TokenUpdated.type,
        campaignId: cid,
        payload: { tokenId: before.id, sceneId: before.sceneId },
        changes: [tokenChange(before, after), ...dependants, ...hookChanges],
      });
    },
  });
}

/**
 * FR-MAP-19: hide → players get a `delete`; reveal → an `upsert`. Unchanged → no event. The
 * upsert is read after the hooks: a reveal resets the trail (FR-MAP-66, sprint 5).
 */
export function setTokenHiddenCommand(hooks: TokenHooks) {
  return defineCommand({
    name: MAP_INTENTS.setTokenHidden,
    input: SetTokenHiddenInput,
    execute({ tokenId, hidden }, env): void {
      const { tx, ctx, actor, emit } = env;
      const cid = campaignOf(actor);
      const before = getToken(tx, cid, tokenId);
      if (before.hidden === hidden) return;
      tx.update(token)
        .set({ hidden, updatedAt: ctx.clock.iso() })
        .where(eq(token.id, tokenId))
        .run();
      const after = readToken(tx, tokenId);
      const dependants = rederiveDependants({ tx, ctx, actor }, tokenChange(before, after));
      const hookChanges = hooks.run({ tx, ctx, actor }, before, after);
      emit({
        type: hidden ? TokenHidden.type : TokenRevealed.type,
        campaignId: cid,
        payload: { tokenId, sceneId: before.sceneId },
        changes: [tokenChange(before, readToken(tx, tokenId)), ...dependants, ...hookChanges],
      });
    },
  });
}

/**
 * FR-MAP-17: same definition, image, size, shape, `creatureType`, speed, owner, hidden flag, `invisible`
 * (FR-FOG-45); numbered name; at `duplicateCell` (free of other tokens, BL-163); `fogged` / `seenBy`
 * derived at that cell (FR-FOG-10).
 */
export const duplicateToken = defineCommand({
  name: MAP_INTENTS.duplicateToken,
  input: TokenIdInput,
  execute({ tokenId }, env): { tokenId: string } {
    const { tx, ctx, actor, emit } = env;
    const cid = campaignOf(actor);
    const src = getToken(tx, cid, tokenId);
    const s = findScene(tx, cid, src.sceneId) as SceneRecord;
    resolveDefinition(env, src.definitionId);
    assertCaps(tx, cid, s.id, 1);
    const cell = duplicateCell(s, src, sceneTokens(tx, s.id));
    const after = insertToken(env, {
      campaignId: cid,
      sceneId: s.id,
      definitionId: src.definitionId,
      name: numberedName(src.name, namesOn(tx, s.id)),
      imageAssetId: assetOrNull(env, src.imageAssetId),
      size: src.size,
      shape: src.shape,
      creatureType: src.creatureType,
      speed: src.speed,
      col: cell.col,
      row: cell.row,
      ownerPlayerId: src.ownerPlayerId,
      hidden: src.hidden,
      characterId: src.characterId,
      invisible: src.invisible === true,
      ...tokenCopies(tx, { ...src, sceneId: s.id, col: cell.col, row: cell.row }),
    });
    const dependants = rederiveDependants({ tx, ctx, actor }, tokenChange(null, after));
    emit({
      type: TokenDuplicated.type,
      campaignId: cid,
      payload: { tokenId: after.id, sceneId: s.id, sourceTokenId: src.id },
      changes: [tokenChange(null, after), ...dependants],
    });
    return { tokenId: after.id };
  },
});

/** FR-MAP-18: delete (no confirm); token-changed hooks run first and may refuse. */
export function deleteTokenCommand(hooks: TokenHooks) {
  return defineCommand({
    name: MAP_INTENTS.deleteToken,
    input: TokenIdInput,
    execute({ tokenId }, env): void {
      const { tx, ctx, actor, emit } = env;
      const cid = campaignOf(actor);
      const before = getToken(tx, cid, tokenId);
      const hookChanges = hooks.run({ tx, ctx, actor }, before, null);
      tx.delete(token).where(eq(token.id, tokenId)).run();
      const dependants = rederiveDependants({ tx, ctx, actor }, tokenChange(before, null));
      emit({
        type: TokenDeleted.type,
        campaignId: cid,
        payload: { tokenId, sceneId: before.sceneId },
        changes: [tokenChange(before, null), ...dependants, ...hookChanges],
      });
    },
  });
}
