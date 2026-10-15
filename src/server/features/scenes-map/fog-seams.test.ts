// FR-FOG-10/12/13/15/24 seams (ADR-0039): the scene visibility and lifecycle registries ship
// empty, so nothing changes; a test hook shows every call site consults them in the right order.
import { afterEach, describe, expect, test } from "bun:test";
import type { EntityRecord } from "@shared/entities/schemas";
import type { SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import { scene, token } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { RecordChange } from "../../events/types";
import type { SignalSender } from "../../ws/signals";
import { createEntity, UPDATE } from "../entities/commands";
import { goblinBlock } from "../entities/testing";
import { placeTokenIn, MAP_REST as R } from "./commands";
import { dragAudience } from "./drag";
import { lifecycleHooks, sceneHooks } from "./scene-hooks";
import { scenesSetup } from "./testing";
import { runTokenChangedHooks, tokenHooks } from "./token-hooks";
import { tokenVisibility } from "./visibility";
import {
  type SceneCells,
  type SceneObject,
  sceneVisibilityHooks,
  tokenHiddenForPlayers,
  visibilityHooks,
} from "./visibility-hooks";

/** Test fog: per scene, the cells that are "fogged". */
const fogged = new Map<string, Set<string>>();
const cellList = (c: SceneCells): [number, number][] => {
  if (Array.isArray(c)) return c.map(([a, b]) => [a, b]);
  const b = c as { col: number; row: number; w: number; h: number };
  const out: [number, number][] = [];
  for (let r = b.row; r < b.row + b.h; r++)
    for (let x = b.col; x < b.col + b.w; x++) out.push([x, r]);
  return out;
};
const allFogged = (sceneId: string, c: SceneCells) =>
  cellList(c).every(([x, r]) => fogged.get(sceneId)?.has(`${x},${r}`) === true);
const fog = (sceneId: string, ...cells: [number, number][]) => {
  const set = fogged.get(sceneId) ?? new Set<string>();
  for (const [c, r] of cells) set.add(`${c},${r}`);
  fogged.set(sceneId, set);
};

const derived: { obj: SceneObject; row: TokenRecord | undefined }[] = [];
const drags: { tokenId: string; at: { col: number; row: number } | null }[] = [];

afterEach(() => {
  visibilityHooks.unregister("test.fog");
  lifecycleHooks.unregister("test.lifecycle");
  tokenHooks.unregister("test.spy");
  fogged.clear();
  derived.length = 0;
  drags.length = 0;
});

/** Registers the test fog: derive from `fogged`, hide fogged ownerless tokens, drag rule. */
function registerFog() {
  visibilityHooks.register({
    name: "test.fog",
    derive(read, obj) {
      // Read-only access to the committed state: the token row (if any) before the write.
      const row = read
        .select()
        .from(token)
        .where(eq(token.sceneId, obj.sceneId))
        .all()
        .find((x) => cellList(obj.cells).some(([c, r]) => x.col === c && x.row === r));
      derived.push({ obj, row: row as TokenRecord | undefined });
      return { fogged: allFogged(obj.sceneId, obj.cells) };
    },
    hides: (type, r) =>
      type === "token" &&
      (r as TokenRecord).fogged === true &&
      (r as TokenRecord).ownerPlayerId === null,
    dragToDm(_read, t, at) {
      drags.push({ tokenId: t.id, at });
      if (at === null) return t.fogged === true && t.ownerPlayerId === null;
      return t.ownerPlayerId === null && allFogged(t.sceneId, { ...at, w: 1, h: 1 });
    },
  });
}

const PlaceOne = z.object({
  sceneId: z.string(),
  definitionId: z.string(),
  col: z.int(),
  row: z.int(),
});
const placeOne = defineCommand({
  name: "test.placeOne",
  input: PlaceOne,
  execute(input, env): TokenRecord {
    const { token: t, change } = placeTokenIn(env, { ...input, hidden: false });
    env.emit({
      type: "TokenPlaced",
      campaignId: t.campaignId,
      payload: { tokenId: t.id, sceneId: t.sceneId },
      changes: [change],
    });
    return t;
  },
});

function setup() {
  const t = scenesSetup();
  t.s.commands.register(placeOne as unknown as CommandDef);
  const newScene = (name = "Goblin Ambush") =>
    t.run<SceneRecord>(R.createScene, { name, mapAssetId: "map-battle" });
  const place = (sceneId: string, definitionId: string, col: number, row: number, extra = {}) => {
    const { tokenId } = t.run<{ tokenId: string }>(I.placeToken, {
      sceneId,
      definitionId,
      col,
      row,
      ...extra,
    });
    return row_(tokenId);
  };
  const raw = (id: string) => t.s.db.select().from(token).where(eq(token.id, id)).get();
  const row_ = (id: string) => {
    const r = raw(id);
    if (!r) throw new Error(`no token ${id}`);
    const { fogged: f, ...rest } = r;
    return (f ? { ...rest, fogged: true } : rest) as TokenRecord;
  };
  const lastEvent = () => t.events.at(-1)?.event;
  return { ...t, newScene, place, raw, tokenRow: row_, lastEvent };
}

describe("FR-FOG-24 registries (empty)", () => {
  test("FR-FOG-24 both registries ship empty: no derive, no hides, no lifecycle rows", () => {
    expect(sceneVisibilityHooks).toEqual([]);
    expect(sceneHooks).toEqual([]);
    const t = setup();
    const s = t.newScene();
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["scene"]);
    const g = t.place(s.id, t.h.goblinId, 3, 3);
    t.run(I.moveToken, { tokenId: g.id, col: 4, row: 4 });
    t.run(I.duplicateToken, { tokenId: g.id });
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: s.id });
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["scene", "token", "token"]);
    expect(
      t.s.db
        .select()
        .from(token)
        .all()
        .every((x) => x.fogged === false),
    ).toBe(true);
    expect(tokenHiddenForPlayers(t.tokenRow(g.id))).toBe(false);
    expect(tokenVisibility(t.tokenRow(g.id), t.h.viewer("player", t.h.p1.id))).toBe("redacted");
    t.run(R.deleteScene, { id: copy.id });
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["token", "token", "scene"]);
  });
});

describe("FR-FOG-10 derive per call site", () => {
  test("FR-FOG-10 derive map.placeToken, placeTokenIn, map.duplicateToken: token footprint, before the write", () => {
    const t = setup();
    const s = t.newScene();
    registerFog();
    fog(s.id, [5, 5], [6, 5], [7, 5]);
    const a = t.place(s.id, t.h.goblinId, 5, 5);
    expect(a.fogged).toBe(true);
    expect(derived.at(-1)?.obj).toEqual({
      type: "token",
      sceneId: s.id,
      cells: { col: 5, row: 5, w: 1, h: 1 },
    });
    expect(derived.at(-1)?.row).toBeUndefined(); // derive runs before the insert
    expect(t.lastEvent()?.changes[0]?.after).toMatchObject({ id: a.id, fogged: true });
    const b = t.run<TokenRecord>("test.placeOne", {
      sceneId: s.id,
      definitionId: t.h.goblinId,
      col: 9,
      row: 9,
    });
    expect(b.fogged).toBeUndefined();
    expect(t.raw(b.id)?.fogged).toBe(false);
    // Duplicate lands at col + 1 (fogged), then again at col + 1 of 6 → 7 (fogged).
    const { tokenId: d } = t.run<{ tokenId: string }>(I.duplicateToken, { tokenId: a.id });
    expect(t.tokenRow(d)).toMatchObject({ col: 6, row: 5, fogged: true });
    const wolf = t.place(s.id, t.h.wolfId, 0, 0);
    const { tokenId: d2 } = t.run<{ tokenId: string }>(I.duplicateToken, { tokenId: wolf.id });
    expect(t.tokenRow(d2)).toMatchObject({ col: 1, row: 0 });
    expect(t.raw(d2)?.fogged).toBe(false);
  });

  test("FR-FOG-10 derive map.moveToken: derived before the single write; hooks see after.fogged", () => {
    const t = setup();
    const s = t.newScene();
    const g = t.place(s.id, t.h.goblinId, 1, 1);
    registerFog();
    fog(s.id, [2, 1]);
    const seen: (true | undefined)[] = [];
    tokenHooks.register("test.spy", (_env, _before, after) => {
      seen.push(after?.fogged);
      return [];
    });
    t.run(I.moveToken, { tokenId: g.id, col: 2, row: 1 });
    // The derive read saw no token at (2, 1) yet: the write came after it.
    expect(derived.at(-1)?.obj.cells).toEqual({ col: 2, row: 1, w: 1, h: 1 });
    expect(derived.at(-1)?.row).toBeUndefined();
    expect(seen).toEqual([true]);
    const ev = t.lastEvent();
    expect(ev?.type).toBe("TokenMoved");
    expect(ev?.changes[0]?.after).toMatchObject({ col: 2, row: 1, fogged: true });
    // Walking out: one write clears it.
    t.run(I.moveToken, { tokenId: g.id, col: 3, row: 1 });
    expect(t.raw(g.id)?.fogged).toBe(false);
    expect(seen).toEqual([true, undefined]);
  });

  test("FR-FOG-10 derive map.duplicateScene: copies derive against the copy, after its lifecycle hooks", () => {
    const t = setup();
    const s = t.newScene();
    const g = t.place(s.id, t.h.goblinId, 4, 4);
    const w = t.place(s.id, t.h.wolfId, 8, 8);
    registerFog();
    const order: string[] = [];
    lifecycleHooks.register({
      name: "test.lifecycle",
      duplicated(env, source, copy) {
        const n = env.tx.select().from(token).where(eq(token.sceneId, copy.id)).all().length;
        order.push(`duplicated:${source.id === s.id}:${n}`);
        fog(copy.id, [4, 4]); // the copy's own fog, before its tokens are written
        return [{ type: "probe-row", id: copy.id, before: null, after: { id: copy.id } }];
      },
    });
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: s.id });
    expect(order).toEqual(["duplicated:true:0"]);
    expect(derived.map((d) => d.obj.sceneId)).toEqual([copy.id, copy.id]);
    const copies = t.s.db.select().from(token).where(eq(token.sceneId, copy.id)).all();
    expect(copies.map((c) => [c.name, c.fogged])).toEqual([
      [g.name, true],
      [w.name, false],
    ]);
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual([
      "scene",
      "probe-row",
      "token",
      "token",
    ]);
  });

  test("FR-FOG-10 / FR-FOG-13 size refresh: re-derived; token-changed hooks only on a fog-hidden flip", () => {
    const t = setup();
    const s = t.newScene();
    const ogre = t.run<EntityRecord>(createEntity.name, {
      kind: "monster",
      name: "Cave Ogre",
      statBlock: { ...goblinBlock, size: "small" },
    });
    registerFog();
    fog(s.id, [10, 0], [12, 12], [13, 12], [12, 13], [13, 13], [5, 5]);
    const a = t.place(s.id, ogre.id, 10, 0); // fogged small → not all of Large fogged: flips
    const b = t.place(s.id, ogre.id, 12, 12); // fogged small → Large still fogged: no flip
    const c = t.place(s.id, ogre.id, 1, 1); // clear → clear: no flip
    const owned = t.place(s.id, ogre.id, 5, 5, { ownerPlayerId: t.h.p1.id }); // fogged, exempt
    expect([a.fogged, b.fogged, c.fogged, owned.fogged]).toEqual([true, true, undefined, true]);
    const calls: string[] = [];
    tokenHooks.register("test.spy", (_env, before, after) => {
      calls.push(`${before.id}:${before.fogged}->${after?.fogged}`);
      return [{ type: "probe-row", id: `for-${before.id}`, before: null, after: { id: 1 } }];
    });
    const n = readEventLog(t.s.db).length;
    t.run(UPDATE, { id: ogre.id, name: "Cave Ogre", statBlock: { ...goblinBlock, size: "large" } });
    expect(calls).toEqual([`${a.id}:true->undefined`]);
    expect(t.raw(a.id)).toMatchObject({ size: "large", fogged: false });
    expect(t.raw(b.id)).toMatchObject({ size: "large", fogged: true });
    expect(t.raw(owned.id)).toMatchObject({ size: "large", fogged: false });
    const ev = t.lastEvent();
    expect(ev?.type).toBe("EntityUpdated");
    expect(ev?.changes.map((x) => [x.type, x.id])).toEqual([
      ["entity", ogre.id],
      ["token", a.id],
      ["token", b.id],
      ["token", c.id],
      ["token", owned.id],
      ["probe-row", `for-${a.id}`],
    ]);
    expect(readEventLog(t.s.db).length).toBe(n + 1);
    // A hook's reject rolls the whole update back.
    tokenHooks.unregister("test.spy");
    tokenHooks.register("test.spy", () => {
      throw conflict("Token is in a running encounter");
    });
    fog(s.id, [11, 0], [10, 1], [11, 1]); // a is Large over a fully fogged block → flips back
    expect(
      t.err(() =>
        t.run(UPDATE, {
          id: ogre.id,
          name: "Cave Ogre",
          statBlock: { ...goblinBlock, size: "medium" },
        }),
      ).code,
    ).toBe("conflict");
    expect(t.raw(a.id)?.size).toBe("large");
  });
});

describe("FR-FOG-12 token fn consults hides", () => {
  test("FR-FOG-12 hidden or any hides → hidden for players; DM full; covering = delete, revealing = upsert", () => {
    const t = setup();
    const s = t.newScene();
    t.run(I.activateScene, { sceneId: s.id });
    const g = t.place(s.id, t.h.goblinId, 1, 1);
    const mira = t.place(s.id, t.miraId, 2, 1);
    registerFog();
    fog(s.id, [3, 1], [2, 1]);
    const p1 = t.h.viewer("player", t.h.p1.id);
    const p2 = t.h.viewer("player", t.h.p2.id);
    const dm = t.h.viewer("dm");
    t.run(I.moveToken, { tokenId: g.id, col: 3, row: 1 });
    const into = t.lastEvent()?.changes[0] as RecordChange;
    expect(t.s.records.filterChange(into, p2)).toEqual({ type: "token", id: g.id, op: "delete" });
    expect(t.s.records.filterChange(into, dm)?.op).toBe("upsert");
    expect(tokenVisibility(t.tokenRow(g.id), p1)).toBe("hidden");
    expect(tokenHiddenForPlayers(t.tokenRow(g.id))).toBe(true);
    // Owned token in fog stays visible to every player, carrying `fogged: true`.
    t.run(I.moveToken, { tokenId: mira.id, col: 2, row: 1 });
    expect(t.tokenRow(mira.id).fogged).toBe(true);
    const ids = (v: typeof p1) => (t.h.snapshot(v).token ?? []).map((r) => (r as TokenRecord).id);
    expect(ids(p2)).toEqual([mira.id]);
    expect(ids(dm).sort()).toEqual([g.id, mira.id].sort());
    t.run(I.moveToken, { tokenId: g.id, col: 4, row: 1 });
    const out = t.lastEvent()?.changes[0] as RecordChange;
    expect(t.s.records.filterChange(out, p2)?.op).toBe("upsert");
    // The `hidden` flag is independent.
    t.run(I.setTokenHidden, { tokenId: g.id, hidden: true });
    expect(tokenHiddenForPlayers(t.tokenRow(g.id))).toBe(true);
  });

  test("FR-FOG-12 a player can't move a token hidden from players (not_found, as unknown)", () => {
    const t = setup();
    const s = t.newScene();
    t.run(I.activateScene, { sceneId: s.id });
    const mira = t.place(s.id, t.miraId, 2, 1);
    visibilityHooks.register({
      name: "test.fog",
      hides: (_type, r) => (r as TokenRecord).id === mira.id,
    });
    expect(
      t.err(() => t.run(I.moveToken, { tokenId: mira.id, col: 3, row: 1 }, t.player(t.h.p1))).code,
    ).toBe("not_found");
    visibilityHooks.unregister("test.fog");
    t.run(I.moveToken, { tokenId: mira.id, col: 3, row: 1 }, t.player(t.h.p1));
    expect(t.tokenRow(mira.id).col).toBe(3);
  });
});

describe("FR-FOG-15 map.drag audience", () => {
  const read = (t: ReturnType<typeof setup>) => ({
    db: t.s.db,
    activeSceneOf: (cid: string) => t.s.records.activeSceneOf(cid),
  });
  const sender = (
    t: ReturnType<typeof setup>,
    role: "dm" | "player",
    playerId: string | null = null,
  ) => ({ connId: "c", campaignId: t.h.campaignId, role, playerId }) as SignalSender;

  test("FR-FOG-15 dragToDm: previewed cell (FR-MAP-15 rounding) into fog → dm; end by stored state; owned → all", () => {
    const t = setup();
    const s = t.newScene();
    t.run(I.activateScene, { sceneId: s.id });
    const g = t.place(s.id, t.h.goblinId, 1, 1);
    const mira = t.place(s.id, t.miraId, 1, 2);
    const dm = sender(t, "dm");
    const drag = (tokenId: string, x: number, y: number) => ({ sceneId: s.id, tokenId, x, y });
    // No hook: every visible token's frames go to all.
    expect(dragAudience(drag(g.id, 140, 70), dm, read(t))).toBe("all");
    registerFog();
    fog(s.id, [2, 1], [3, 1]);
    expect(dragAudience(drag(g.id, 100, 70), dm, read(t))).toBe("all"); // 100/70 → col 1
    expect(dragAudience(drag(g.id, 110, 70), dm, read(t))).toBe("dm"); // 110/70 → col 2
    expect(drags.at(-1)).toEqual({ tokenId: g.id, at: { col: 2, row: 1 } });
    expect(dragAudience({ sceneId: s.id, tokenId: g.id, end: true }, dm, read(t))).toBe("all");
    expect(drags.at(-1)).toEqual({ tokenId: g.id, at: null });
    // Owned: never routed by the fog rule.
    expect(dragAudience(drag(mira.id, 140, 70), sender(t, "player", t.h.p1.id), read(t))).toBe(
      "all",
    );
    // Stored fog-hidden: every frame (position and end) → dm; a player sender sees it as unknown.
    t.run(I.moveToken, { tokenId: g.id, col: 3, row: 1 });
    expect(dragAudience(drag(g.id, 0, 0), dm, read(t))).toBe("dm");
    expect(dragAudience({ sceneId: s.id, tokenId: g.id, end: true }, dm, read(t))).toBe("dm");
    expect(() => dragAudience(drag(g.id, 0, 0), sender(t, "player", t.h.p1.id), read(t))).toThrow(
      /not found/i,
    );
  });
});

describe("FR-FOG-23 / FR-FOG-02 scene lifecycle hooks", () => {
  test("FR-FOG-24 created: in map.createScene's transaction, rows join SceneCreated; a throw rolls back", () => {
    const t = setup();
    let fail = false;
    lifecycleHooks.register({
      name: "test.lifecycle",
      created(env, sc) {
        if (fail) throw conflict("nope");
        const n = env.tx.select().from(scene).where(eq(scene.id, sc.id)).all().length;
        return [{ type: "probe-row", id: sc.id, before: null, after: { id: sc.id, n } }];
      },
    });
    const s = t.newScene();
    expect(t.lastEvent()?.changes).toEqual([
      { type: "scene", id: s.id, before: null, after: s },
      { type: "probe-row", id: s.id, before: null, after: { id: s.id, n: 1 } },
    ]);
    fail = true;
    const n = t.count("scene");
    const log = readEventLog(t.s.db).length;
    expect(t.err(() => t.newScene("Cellar")).code).toBe("conflict");
    expect(t.count("scene")).toBe(n);
    expect(readEventLog(t.s.db).length).toBe(log);
  });

  test("FR-FOG-23 deleting: before any row is deleted; rows join SceneDeleted before the scene delete", () => {
    const t = setup();
    const s = t.newScene();
    const g = t.place(s.id, t.h.goblinId, 1, 1);
    const order: string[] = [];
    tokenHooks.register("test.spy", (_env, before) => {
      order.push(`token:${before.id}`);
      return [];
    });
    let fail = false;
    lifecycleHooks.register({
      name: "test.lifecycle",
      deleting(env, sc) {
        const tokens = env.tx.select().from(token).where(eq(token.sceneId, sc.id)).all();
        order.push(`deleting:${tokens.length}`);
        if (fail) throw conflict("nope");
        return [{ type: "probe-row", id: sc.id, before: { id: sc.id }, after: null }];
      },
    });
    fail = true;
    expect(t.err(() => t.run(R.deleteScene, { id: s.id })).code).toBe("conflict");
    expect(t.count("token")).toBe(1);
    fail = false;
    order.length = 0;
    t.run(R.deleteScene, { id: s.id });
    expect(order).toEqual(["deleting:1", `token:${g.id}`]);
    expect(t.lastEvent()?.changes.map((c) => [c.type, c.id])).toEqual([
      ["token", g.id],
      ["probe-row", s.id],
      ["scene", s.id],
    ]);
  });

  test("FR-FOG-24 runTokenChangedHooks runs every registered token-changed hook", () => {
    const t = setup();
    const s = t.newScene();
    const g = t.place(s.id, t.h.goblinId, 1, 1);
    tokenHooks.register("test.spy", (_env, before, after) => [
      { type: "probe-row", id: before.id, before: null, after: { gone: after === null } },
    ]);
    const rows = t.s.db.transaction((tx) =>
      runTokenChangedHooks(
        { tx, ctx: { ids: { next: () => "x" } } as never, actor: t.h.dm },
        g,
        null,
      ),
    );
    expect(rows.filter((r) => r.type === "probe-row")).toEqual([
      { type: "probe-row", id: g.id, before: null, after: { gone: true } },
    ]);
  });
});
