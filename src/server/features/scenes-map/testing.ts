// Test support for scenes-map commands: entities' seed (two campaigns, players, imported goblin
// + wolf) plus a map asset, token art and characters Mira (player 1) and Thorn (player 2).
import { sql } from "drizzle-orm";
import { seededContext } from "../../commands/context";
import { CommandError } from "../../commands/errors";
import { asset } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, DispatchedEvent } from "../../events/types";
import type { Logger } from "../../log";
import { createEntity } from "../entities/commands";
import { entityServices, miraBlock, seedEntities, thornBlock } from "../entities/testing";

export function addAsset(
  s: ReturnType<typeof entityServices>,
  id: string,
  campaignId: string,
  size: { w: number; h: number } = { w: 256, h: 256 },
) {
  s.db
    .insert(asset)
    .values({
      id,
      campaignId,
      seq: sql`(select coalesce(max(seq), 0) + 1 from asset)`,
      name: id,
      hash: id.padEnd(64, "0"),
      mime: "image/png",
      bytes: 1,
      width: size.w,
      height: size.h,
      displayWidth: size.w,
      displayHeight: size.h,
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    .run();
}

export function scenesSetup(log?: Logger) {
  const s = entityServices(log);
  const h = seedEntities(s);
  addAsset(s, "map-battle", h.campaignId, { w: 1400, h: 980 });
  addAsset(s, "map-town", h.campaignId, { w: 2100, h: 1400 });
  addAsset(s, "art-mira", h.campaignId);
  addAsset(s, "art-elite", h.campaignId);
  addAsset(s, "art-other", h.secondCampaignId);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => events.push(e));
  const run = <R = unknown>(name: string, input: unknown, actor: Actor = h.dm, key?: string) =>
    s.commands.run(name, input, {
      actor,
      ...(key ? { ctx: seededContext({ disposable: true, key }) } : {}),
    }) as R;
  const err = (fn: () => unknown): CommandError => {
    try {
      fn();
    } catch (e) {
      if (e instanceof CommandError) return e;
      throw e;
    }
    throw new Error("expected a CommandError");
  };
  const mira = run<{ id: string }>(createEntity.name, {
    kind: "character",
    name: "Mira",
    ownerPlayerId: h.p1.id,
    portraitAssetId: "art-mira",
    statBlock: miraBlock,
  });
  const thorn = run<{ id: string }>(createEntity.name, {
    kind: "character",
    name: "Thorn",
    ownerPlayerId: h.p2.id,
    statBlock: thornBlock,
  });
  const player = (p: { id: string }): Actor => ({
    role: "player",
    playerId: p.id,
    campaignId: h.campaignId,
  });
  const count = (table: string) =>
    s.db.$client.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0;
  const logTypes = () => readEventLog(s.db).map((l) => l.type);
  return {
    s,
    h,
    events,
    run,
    err,
    miraId: mira.id,
    thornId: thorn.id,
    player,
    count,
    logTypes,
  };
}
