// CBT §12 / FR-CBT-135 CON-44 (sprint 7, GM2; ceilings DM 1.5 MiB since #256, players 512 KiB):
// the realistic-heavy harness on `session-sim`, gems on, then the spec's worst case written
// straight to the rows: every pending damage card with damage maxed (`maxed` on the base part,
// `diceMaxed` on the card), topped up to the spec's 20 pending cards. Measured 29 B a card
// (`,"maxed":[0]` 12 B + `,"diceMaxed":true` 17 B; 3 dice 33 B): the spec's "+16–20 B, ≤ 25 B"
// undercounted the keys; bound 35 B (reported at GM2). A player pays only for their own cards.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { library } from "@fixtures/index";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { DAMAGE_CARD_KIND, DamageCardPayload } from "@shared/combat-tracker/schemas";
import { and, eq } from "drizzle-orm";
import { campaign, notification } from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";
import { setFeature } from "../campaign-management/features";
import { loadInProcess } from "../fixtures-adapters/loader";

/** FR-CBT-135: bytes one maxed card may add for a viewer that gets it (measured 29–33 B). */
const PER_CARD_MAX = 35;
const CARDS = 20;

describe("FR-CBT-135 CON-44 maxed (CBT §12)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let unmaxed: ViewerSize[];
  let maxed: ViewerSize[];
  let perViewer: number[] = [];
  beforeAll(async () => {
    b = await servicesFromBundle(await loadInProcess(library, "session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    const db = b.s.db;
    const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    const dm = { actor: { role: "dm" as const, playerId: null, campaignId: cid } };
    b.s.commands.run(setFeature, { feature: GEMS_FEATURE, on: true }, dm);
    const pending = () =>
      db
        .select()
        .from(notification)
        .where(
          and(
            eq(notification.campaignId, cid),
            eq(notification.kind, DAMAGE_CARD_KIND),
            eq(notification.state, "pending"),
          ),
        )
        .all()
        .filter((n) => DamageCardPayload.safeParse(n.payload).data?.damage);
    // Top up to 20 pending cards with damage (copies of the first, new ids), unmaxed.
    const cards = pending();
    const first = cards[0];
    if (!first) throw new Error("the heavy harness has no pending damage card");
    for (let i = cards.length; i < CARDS; i++) {
      db.insert(notification)
        .values({ ...first, id: `con44-card-${i}`, seq: first.seq + 1000 + i })
        .run();
    }
    const all = pending();
    unmaxed = snapshotSizes(b.s);
    for (const n of all) {
      const p = DamageCardPayload.parse(n.payload);
      if (!p.damage) continue;
      const payload = { ...p, damage: { ...p.damage, maxed: [0] }, diceMaxed: true };
      db.update(notification).set({ payload }).where(eq(notification.id, n.id)).run();
    }
    maxed = snapshotSizes(b.s);
    // Cards each viewer receives (DM: all; a player: their own).
    perViewer = snapshotFrames(b.s).map(
      (f) =>
        (
          (f.records.notification ?? []) as { kind: string; payload: { diceMaxed?: true } }[]
        ).filter((n) => n.kind === DAMAGE_CARD_KIND && n.payload.diceMaxed).length,
    );
  }, 120_000);
  afterAll(() => b.cleanup());

  test("FR-CBT-135 CON-44 maxed: ≤ 35 B per maxed card per viewer that gets it; players only their own; under the ceilings", () => {
    const deltas = maxed.map((v, i) => v.bytes - (unmaxed[i]?.bytes ?? 0));
    const [dm, ...players] = maxed;
    console.log(
      `CBT CON-44 (GM2): ${perViewer[0]} maxed cards; DM ${unmaxed[0]?.bytes} → ${dm?.bytes} B (+${deltas[0]}); players +${Math.min(...deltas.slice(1))}…+${Math.max(...deltas.slice(1))} (${perViewer.slice(1).join(", ")} cards), max ${Math.max(...players.map((p) => p.bytes))} B`,
    );
    expect(perViewer[0]).toBeGreaterThanOrEqual(CARDS);
    deltas.forEach((d, i) => {
      expect(d).toBeLessThanOrEqual(PER_CARD_MAX * (perViewer[i] ?? 0));
      if ((perViewer[i] ?? 0) === 0) expect(d).toBe(0);
    });
    expect(dm?.bytes ?? Infinity).toBeLessThan(SNAPSHOT_CEILING.dm);
    for (const p of players) expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
  });
});
