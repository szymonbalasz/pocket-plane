// FR-MAP-48: `placeTokenIn`, `map.placeToken` minus intent and event, run inside another
// command's transaction (combat's created tokens). `freeCellsNear` is in @shared/scenes-map.
import { describe, expect, test } from "bun:test";
import { defineEvent } from "@shared/events/types";
import type { SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import { MAP_INTENTS as I, TOKENS_PER_SCENE_MAX } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { seededContext } from "../../commands/context";
import { token } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { placeTokenIn, MAP_REST as R } from "./commands";
import { toTokenRecord } from "./rows";
import { scenesSetup } from "./testing";
import { tokenHooksOf } from "./token-hooks";

const Placed = defineEvent({
  type: "TestTokensPlaced",
  payload: z.object({ tokenIds: z.array(z.string()) }),
  logged: true,
  undoable: false,
});

const Spec = z.object({
  sceneId: z.string(),
  definitionId: z.string(),
  col: z.int(),
  row: z.int(),
  hidden: z.boolean(),
  name: z.string().optional(),
});

/** A caller's command: places every spec, one event listing every change. */
const placeAll = defineCommand({
  name: "test.placeAll",
  input: z.object({ specs: z.array(Spec) }),
  execute({ specs }, env): { tokens: TokenRecord[] } {
    const placed = specs.map((s) => placeTokenIn(env, s));
    env.emit({
      type: Placed.type,
      campaignId: env.actor.campaignId as string,
      payload: { tokenIds: placed.map((p) => p.token.id) },
      changes: placed.map((p) => p.change),
    });
    return { tokens: placed.map((p) => p.token) };
  },
});

function setup() {
  const t = scenesSetup();
  t.s.commands.registerEvent(Placed);
  t.s.commands.register(placeAll as unknown as CommandDef);
  const scene = t.run<SceneRecord>(R.createScene, {
    name: "Goblin Ambush",
    mapAssetId: "map-battle",
  });
  const hookCalls: string[] = [];
  tokenHooksOf(t.s).register("test-spy", (_env, before) => {
    hookCalls.push(before.id);
    return [];
  });
  const spec = (definitionId: string, col: number, row: number, extra = {}) => ({
    sceneId: scene.id,
    definitionId,
    col,
    row,
    hidden: false,
    ...extra,
  });
  return { ...t, scene, hookCalls, spec };
}

describe("FR-MAP-48 placeTokenIn", () => {
  test("same rules as map.placeToken, in the caller's transaction and event; no token-changed hooks", () => {
    const t = setup();
    const placedByIntent = t.run<{ tokenId: string }>(I.placeToken, t.spec(t.h.goblinId, 0, 0));
    const before = readEventLog(t.s.db).length;
    const { tokens } = t.run<{ tokens: TokenRecord[] }>(
      "test.placeAll",
      {
        specs: [
          t.spec(t.h.goblinId, 2, 2, { hidden: true }),
          t.spec(t.h.goblinId, 3, 2, { hidden: true }),
          t.spec(t.miraId, 4, 4),
        ],
      },
      t.h.dm,
      "combat-1",
    );
    // FR-MAP-16 numbering counts the intent's token and earlier ones of this command.
    expect(tokens.map((x) => x.name)).toEqual(["Goblin 2", "Goblin 3", "Mira"]);
    expect(tokens[0]).toMatchObject({
      hidden: true,
      size: "small",
      shape: "round",
      speed: 30,
      ownerPlayerId: null,
      characterId: null,
      definitionId: t.h.goblinId,
    });
    // FR-MAP-13 character copies: owner, portrait; FR-MAP-50 characterId.
    expect(tokens[2]).toMatchObject({
      ownerPlayerId: t.h.p1.id,
      imageAssetId: "art-mira",
      characterId: t.miraId,
      hidden: false,
    });
    // IDs and time from ctx.
    const ctx = seededContext({ disposable: true, key: "combat-1" });
    expect(tokens[0]?.id).toBe(ctx.ids.next());
    expect(tokens[0]?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    // One event, one log row, every change listed (create = before null).
    const log = readEventLog(t.s.db).slice(before);
    expect(log.map((l) => l.type)).toEqual(["TestTokensPlaced"]);
    const ev = t.events.at(-1)?.event;
    expect(ev?.changes.map((c) => [c.type, c.id, c.before])).toEqual(
      tokens.map((x) => ["token", x.id, null]),
    );
    expect(ev?.changes.map((c) => c.after)).toEqual(tokens);
    expect(t.hookCalls).toEqual([]);
    expect(placedByIntent.tokenId).not.toBe(tokens[0]?.id);
  });

  test("off the map → invalid, caps → conflict: the caller's command writes nothing", () => {
    const t = setup();
    const n = t.count("token");
    const log = readEventLog(t.s.db).length;
    const offMap = t.err(() =>
      t.run("test.placeAll", {
        specs: [t.spec(t.h.goblinId, 1, 1), t.spec(t.h.goblinId, 99, 99)],
      }),
    );
    expect(offMap.code).toBe("invalid");
    expect(t.count("token")).toBe(n);
    expect(readEventLog(t.s.db).length).toBe(log);
    const many = Array.from({ length: TOKENS_PER_SCENE_MAX + 1 }, (_, i) =>
      t.spec(t.h.goblinId, i % 20, Math.floor(i / 20) % 14),
    );
    expect(t.err(() => t.run("test.placeAll", { specs: many })).code).toBe("conflict");
    expect(t.count("token")).toBe(n);
    // Another campaign's scene → not_found (unknown).
    expect(
      t.err(() =>
        t.run("test.placeAll", { specs: [t.spec(t.h.goblinId, 1, 1)] }, { ...t.h.dmSecond }),
      ).code,
    ).toBe("not_found");
  });

  test("map.placeToken keeps its behaviour (TokenPlaced with the one change)", () => {
    const t = setup();
    const { tokenId } = t.run<{ tokenId: string }>(I.placeToken, t.spec(t.h.wolfId, 5, 5));
    const row = toTokenRecord(
      t.s.db.select().from(token).where(eq(token.id, tokenId)).get() as typeof token.$inferSelect,
    );
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("TokenPlaced");
    expect(ev?.payload).toEqual({ tokenId, sceneId: t.scene.id });
    expect(ev?.changes).toEqual([{ type: "token", id: tokenId, before: null, after: row }]);
  });
});
