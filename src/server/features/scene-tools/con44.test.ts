// SCN §12 / §13 CON-44 for sprint 4 (Mc; #208 ceilings: DM 1 MiB, players 512 KiB): the
// realistic-heavy harness (`session-sim` + `buildRealisticHeavy`) with its prepped battle scene
// filled to the kept-template cap (20 per scene, 40-char labels, 36-char ids), first with
// integer origins and 15° angles (sprint 2's wire), then freeform (2-decimal `x`, `y`, 1-decimal
// `angle`). Copies come from the product path (`templateCopies`). Measured, never a ceiling raise.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import {
  AOE_TEMPLATE_TYPE,
  TEMPLATE_LABEL_MAX,
  TEMPLATE_SHAPES,
  TEMPLATES_PER_PLAYER_MAX,
  TEMPLATES_PER_SCENE_MAX,
  type TemplateGeometry,
} from "@shared/scene-tools/schemas";
import { eq } from "drizzle-orm";
import { aoeTemplate, aoeTemplateSeqNext, campaign, player } from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  sceneLoadSizes,
  servicesFromBundle,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";
import { readScene } from "../scenes-map/rows";
import { templateCopies } from "./copies";

const AT = "2026-01-01T00:00:00.000Z";
const SCENE_LOAD_MAX = 512 * 1024;
const fill = (prefix: string, n: number) => (prefix + "x".repeat(n)).slice(0, n);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

describe("CON-44 with kept templates at the cap, freeform (SCN §12 sprint 4)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let base: ViewerSize[];
  let integer: ViewerSize[];
  let freeform: ViewerSize[];
  let sceneId: string;
  let added: string[];

  /** Rewrites every added template's geometry (and its copies, as the commands would). */
  function setGeometry(free: boolean) {
    const db = b.s.db;
    const s = db.transaction((tx) => readScene(tx, sceneId));
    for (const [i, id] of added.entries()) {
      const row = db.select().from(aoeTemplate).where(eq(aoeTemplate.id, id)).get();
      if (!row) throw new Error(id);
      const g: TemplateGeometry = {
        shape: row.shape,
        // Inside Goblin-Ambush-sized maps; 2 decimals / 1 decimal when free (never a round
        // number, so every row carries its longest form).
        x: free ? round(1.37 + ((i * 0.91) % 17), 2) : 1 + (i % 17),
        y: free ? round(1.53 + ((i * 0.67) % 11), 2) : 1 + (i % 11),
        size: row.size,
        width: row.width,
        angle: free ? round(((i * 37.3) % 359) + 0.1, 1) : (i * 15) % 360,
      };
      db.update(aoeTemplate)
        .set({ ...g, ...templateCopies(db, s, g, row.placedByPlayerId) })
        .where(eq(aoeTemplate.id, id))
        .run();
    }
  }

  beforeAll(async () => {
    b = await servicesFromBundle(await loadBundle("session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    const db = b.s.db;
    const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    const kept = db.select().from(aoeTemplate).where(eq(aoeTemplate.campaignId, cid)).all();
    sceneId = kept[0]?.sceneId as string;
    base = snapshotSizes(b.s);
    // Up to the cap: 3 more per player while the per-player cap allows, the rest DM-placed.
    const players = db.select().from(player).where(eq(player.campaignId, cid)).all();
    const perPlayer = new Map<string, number>();
    for (const t of kept)
      if (t.placedByPlayerId)
        perPlayer.set(t.placedByPlayerId, (perPlayer.get(t.placedByPlayerId) ?? 0) + 1);
    added = [];
    for (let i = kept.length; i < TEMPLATES_PER_SCENE_MAX; i++) {
      const p = players[i % players.length];
      const mine = p ? (perPlayer.get(p.id) ?? 0) : TEMPLATES_PER_PLAYER_MAX;
      const placedBy = p && i % 2 === 0 && mine < TEMPLATES_PER_PLAYER_MAX ? p.id : null;
      if (placedBy) perPlayer.set(placedBy, mine + 1);
      const shape = TEMPLATE_SHAPES[i % TEMPLATE_SHAPES.length] ?? "sphere";
      const id = fill(`mc-template-${i}-`, 36);
      db.insert(aoeTemplate)
        .values({
          id,
          campaignId: cid,
          sceneId,
          seq: aoeTemplateSeqNext,
          shape,
          x: 0,
          y: 0,
          size: 5 + 5 * (i % 6),
          width: shape === "line" ? 10 : null,
          angle: 0,
          label: fill(`Template ${i + 1} `, TEMPLATE_LABEL_MAX),
          placedByPlayerId: placedBy,
          createdAt: AT,
          updatedAt: AT,
        })
        .run();
      added.push(id);
    }
    setGeometry(false);
    integer = snapshotSizes(b.s);
    setGeometry(true);
    freeform = snapshotSizes(b.s);
  }, 120_000);

  afterAll(() => b?.cleanup());

  test("CON-44 the battle scene at the template cap with decimal fields: DM < 1 MiB, every player < 512 KiB; load ack < 512 KiB", () => {
    const [dm, ...players] = freeform as [ViewerSize, ...ViewerSize[]];
    expect(dm.types[AOE_TEMPLATE_TYPE]?.rows).toBe(TEMPLATES_PER_SCENE_MAX);
    expect(dm.bytes).toBeLessThan(SNAPSHOT_CEILING.dm);
    for (const p of players) expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
    const load = sceneLoadSizes(b.s).find((l) => l.sceneId === sceneId);
    expect(load?.rows[AOE_TEMPLATE_TYPE]).toBe(TEMPLATES_PER_SCENE_MAX);
    expect(load?.bytes).toBeLessThan(SCENE_LOAD_MAX);

    const dmInt = integer[0] as ViewerSize;
    const perRow = (dm.bytes - dmInt.bytes) / added.length;
    // SCN §12 measured +8.3 B per row on the prototype; the stored rows here are the real ones.
    expect(perRow).toBeGreaterThan(0);
    expect(perRow).toBeLessThan(16);
    const visible = players.map((p) => p.types[AOE_TEMPLATE_TYPE]?.rows ?? 0);
    console.log(
      `SCN sprint 4 CON-44: heavy DM ${base[0]?.bytes} B → ${dmInt.bytes} B at the cap (integer) → ${dm.bytes} B freeform (+${dm.bytes - dmInt.bytes} B, ${perRow.toFixed(1)} B per freeform row over ${added.length}; ${SNAPSHOT_CEILING.dm - dm.bytes} B left of 1 MiB); players ${Math.min(...players.map((p) => p.bytes))}–${Math.max(...players.map((p) => p.bytes))} B (${SNAPSHOT_CEILING.player - Math.max(...players.map((p) => p.bytes))} B left of 512 KiB; visible templates ${Math.min(...visible)}–${Math.max(...visible)}); battle load ack ${load?.bytes} B`,
    );
  });
});
