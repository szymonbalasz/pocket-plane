// BL-55: FR-FOG-32's 4-source cap and FR-FOG-52's 12-source party cap log their "gives no vision"
// `warn` once per (scene, player or party, dropped set), not on every derive; vision itself is
// unchanged. On the `vision` bundle with in-process services (Goblin Ambush active).
import { afterEach, describe, expect, test } from "bun:test";
import { type VisionServices, visionServices } from "@fixtures/units/fog-of-war/vision-harness";
import { VISION_TYPE } from "@shared/fog-of-war/schemas";
import { MAP_INTENTS as I, type SceneRecord } from "@shared/scenes-map/schemas";
import { and, eq, isNull, sql } from "drizzle-orm";
import { fogSettings, token } from "../../db/schema";
import { silentLogger } from "../../log";
import { MAP_REST as R } from "../scenes-map/commands";
import { campaignPlayers } from "./derive";
import { capWarnedCount, PARTY_SOURCES_MAX, sceneSources, setFogLogger } from "./sight";

const opened: VisionServices[] = [];
const warned: string[] = [];
async function setup() {
  const t = await visionServices();
  opened.push(t);
  setFogLogger({ ...silentLogger, warn: (m: string) => warned.push(m) });
  return t;
}
afterEach(() => {
  setFogLogger(silentLogger);
  warned.length = 0;
  for (const t of opened.splice(0)) t.stop();
});

const capLines = () => warned.filter((m) => m.includes("more than 4 tokens"));
const partyLines = () => warned.filter((m) => m.includes(`more than ${PARTY_SOURCES_MAX} sources`));

/** Player 1's visible owned tokens on the ambush, rank order (PC first, then `seq`; FR-MAP-78). */
const miraTokens = (t: VisionServices) =>
  t.db
    .select({ id: token.id })
    .from(token)
    .where(
      and(
        eq(token.sceneId, t.ambushId),
        eq(token.ownerPlayerId, t.pid.p1),
        eq(token.hidden, false),
      ),
    )
    .orderBy(sql`${token.characterId} is null`, token.seq)
    .all()
    .map((r) => r.id);

describe("BL-55 FR-FOG-32 cap warning once per dropped set", () => {
  test("BL-55 FR-FOG-32 repeated derives log once; same sources chosen", async () => {
    const t = await setup();
    const mira = t.tokenRow("Mira");
    for (let i = 0; i < 4; i++) t.run(I.duplicateToken, { tokenId: mira.id });
    expect(capLines()).toHaveLength(1);
    const ids = miraTokens(t);
    expect(capLines()[0]).toContain(`token ${ids[4]} gives no vision`);
    // Moves, snapshots and direct reads all re-derive: no new line.
    for (let col = 3; col < 7; col++) {
      t.run(I.moveToken, { tokenId: mira.id, col, row: 5 }, t.actor("p1"));
    }
    t.snapshot("p1");
    const players = campaignPlayers(t.db, t.campaignId);
    const src = sceneSources(t.db, t.ambushId, players).get(t.pid.p1) ?? [];
    expect(capLines()).toHaveLength(1);
    // Vision unchanged: the first 4 in rank order, 4 polygons.
    expect(src.map((s) => s.tokenId)).toEqual(ids.slice(0, 4));
    const v = t.snapshot("p1")[VISION_TYPE]?.[0] as { see: unknown[] };
    expect(v.see).toHaveLength(4);
  });

  test("BL-55 FR-FOG-32 a change in the dropped set logs again", async () => {
    const t = await setup();
    const mira = t.tokenRow("Mira");
    for (let i = 0; i < 4; i++) t.run(I.duplicateToken, { tokenId: mira.id });
    expect(capLines()).toHaveLength(1);
    t.run(I.duplicateToken, { tokenId: mira.id });
    // Two dropped now: both lines, once.
    expect(capLines()).toHaveLength(3);
    t.run(I.moveToken, { tokenId: mira.id, col: 4, row: 5 }, t.actor("p1"));
    expect(capLines()).toHaveLength(3);
  });

  test("BL-55 FR-FOG-32 the condition clears, then comes back: logs again", async () => {
    const t = await setup();
    const mira = t.tokenRow("Mira");
    for (let i = 0; i < 4; i++) t.run(I.duplicateToken, { tokenId: mira.id });
    const last = miraTokens(t)[4] as string;
    expect(capLines()).toHaveLength(1);
    t.run(I.setTokenHidden, { tokenId: last, hidden: true });
    expect(capWarnedCount()).toBe(0);
    t.run(I.moveToken, { tokenId: mira.id, col: 4, row: 5 }, t.actor("p1"));
    expect(capLines()).toHaveLength(1);
    t.run(I.setTokenHidden, { tokenId: last, hidden: false });
    expect(capLines()).toHaveLength(2);
    expect(capLines()[1]).toContain(`token ${last} gives no vision`);
  });

  test("BL-55 FR-FOG-23 another scene logs its own line; deleting it forgets it", async () => {
    const t = await setup();
    const mira = t.tokenRow("Mira");
    for (let i = 0; i < 4; i++) t.run(I.duplicateToken, { tokenId: mira.id });
    expect(capLines()).toHaveLength(1);
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: t.ambushId });
    const players = campaignPlayers(t.db, t.campaignId);
    sceneSources(t.db, copy.id, players);
    sceneSources(t.db, copy.id, players);
    expect(capLines().filter((m) => m.includes(`scene ${copy.id}`))).toHaveLength(1);
    const remembered = capWarnedCount();
    t.run(R.deleteScene, { id: copy.id });
    expect(capWarnedCount()).toBe(remembered - 1);
  });
});

describe("BL-55 FR-FOG-52 party cap warning once per dropped set", () => {
  /** 6 players × 3 owned Goblins, then party vision on and one derive: 6 over the party cap. */
  async function partySetup() {
    const t = await setup();
    for (let i = 3; i <= 6; i++) t.run("player.add", { name: `Player ${i}` });
    const players = campaignPlayers(t.db, t.campaignId);
    t.db.delete(token).where(eq(token.sceneId, t.ambushId)).run();
    const def = t.db
      .select({ id: token.definitionId })
      .from(token)
      .where(isNull(token.ownerPlayerId))
      .get()?.id as string;
    const place = (p: string, col: number) =>
      t.run(I.placeToken, {
        sceneId: t.ambushId,
        definitionId: def,
        col: col % 7,
        row: Math.floor(col / 7) + 2,
        ownerPlayerId: p,
      });
    let col = 0;
    for (let round = 0; round < 3; round++) for (const p of players) place(p, col++);
    expect(partyLines()).toHaveLength(0);
    t.db
      .insert(fogSettings)
      .values({ campaignId: t.campaignId, partyVision: true, updatedAt: "2026-01-01T00:00:00Z" })
      .run();
    sceneSources(t.db, t.ambushId, players, true);
    return { t, players, place };
  }

  test("BL-55 FR-FOG-52 repeated derives log once; same sources chosen", async () => {
    const { t, players } = await partySetup();
    expect(partyLines()).toHaveLength(6);
    const first = sceneSources(t.db, t.ambushId, players, true);
    sceneSources(t.db, t.ambushId, players, true);
    t.snapshot("p1");
    expect(partyLines()).toHaveLength(6);
    expect([...first.values()].map((l) => l.length)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  test("BL-55 FR-FOG-52 a change in the dropped set logs again; clearing then exceeding again logs again", async () => {
    const { t, players, place } = await partySetup();
    expect(partyLines()).toHaveLength(6);
    // One more source: 7 dropped, all logged once.
    place(players[0] as string, 30);
    expect(partyLines()).toHaveLength(13);
    sceneSources(t.db, t.ambushId, players, true);
    expect(partyLines()).toHaveLength(13);
    // Party vision off: the condition clears; on again: the same set logs again.
    t.db
      .update(fogSettings)
      .set({ partyVision: false })
      .where(eq(fogSettings.campaignId, t.campaignId))
      .run();
    sceneSources(t.db, t.ambushId, players, false);
    expect(capWarnedCount()).toBe(0);
    sceneSources(t.db, t.ambushId, players, true);
    expect(partyLines()).toHaveLength(20);
    expect(partyLines().at(-1)).toContain("gives no vision");
  });
});
