// RECAP §12 CON-44 (FR-RECAP-26; ceilings DM 1.5 MiB since #256, players 512 KiB; never raised):
// the realistic-heavy harness on `session-sim`, then (a) one max share (a 280-char note of 4-byte
// characters, every optional section left out) through `recap.share`, and (b) the worst case:
// every closed notification in the snapshot window a max share. No record type: a share is one
// notification row inside the window, so it substitutes for another row (≤ 2 KB payload).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { library } from "@fixtures/index";
import { NOTIFICATION_WINDOW } from "@shared/notifications/schemas";
import {
  OMITTABLE_SECTIONS,
  RECAP_NOTE_MAX,
  RECAP_SHARE_INTENT,
  SESSION_RECAP_KIND,
} from "@shared/session-recap/schemas";
import { and, desc, eq, ne } from "drizzle-orm";
import { campaign, notification } from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";
import { loadInProcess } from "../fixtures-adapters/loader";
import { statsMemory } from "../stats";

/** One max share row's growth per viewer (RECAP §12: measured +1,026 B). */
const ONE_SHARE_MAX = 1_100;
const NOTE = "😀".repeat(RECAP_NOTE_MAX);

describe("RECAP §12 CON-44", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let base: ViewerSize[];
  let one: ViewerSize[];
  let worst: ViewerSize[];

  beforeAll(async () => {
    b = await servicesFromBundle(await loadInProcess(library, "session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    base = snapshotSizes(b.s);
    const db = b.s.db;
    const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    const actor = { role: "dm" as const, playerId: null, campaignId: cid };
    const fromN = statsMemory(b.s).cache.sessions(db, cid).at(-1)?.fromN as number;
    b.s.commands.run(
      RECAP_SHARE_INTENT,
      { fromN, note: NOTE, omit: [...OMITTABLE_SECTIONS] },
      { actor },
    );
    one = snapshotSizes(b.s);
    // Worst: every closed row of the window is a max share (the same payload and text).
    const share = db
      .select()
      .from(notification)
      .where(eq(notification.kind, SESSION_RECAP_KIND))
      .get();
    const closed = db
      .select({ id: notification.id })
      .from(notification)
      .where(and(eq(notification.campaignId, cid), ne(notification.state, "pending")))
      .orderBy(desc(notification.seq))
      .limit(NOTIFICATION_WINDOW)
      .all();
    for (const { id } of closed) {
      db.update(notification)
        .set({
          kind: SESSION_RECAP_KIND,
          audience: "all",
          audiencePlayerId: null,
          text: share?.text as string,
          payload: share?.payload,
          state: "info",
          actionLabel: null,
          actionRole: null,
          actionPlayerId: null,
          resolution: null,
        })
        .where(eq(notification.id, id))
        .run();
    }
    worst = snapshotSizes(b.s);
  });

  afterAll(() => b.cleanup());

  test("FR-RECAP-26 CON-44: one max share ≤ 1.1 KB per viewer; every window row a max share stays under both ceilings", () => {
    const delta = (xs: ViewerSize[]) => xs.map((v, i) => v.bytes - (base[i] as ViewerSize).bytes);
    const ones = delta(one);
    const worsts = delta(worst);
    console.log(
      [
        `CON-44 recap: one max share DM +${ones[0]} B, players +${Math.min(...ones.slice(1))}…+${Math.max(...ones.slice(1))} B`,
        `worst (every window row a max share) DM ${worst[0]?.bytes} B (+${worsts[0]}), players max ${Math.max(...worst.slice(1).map((v) => v.bytes))} B (+${Math.max(...worsts.slice(1))})`,
      ].join("; "),
    );
    for (const d of ones) expect(d).toBeLessThanOrEqual(ONE_SHARE_MAX);
    for (const v of worst) {
      const ceiling = v.role === "dm" ? SNAPSHOT_CEILING.dm : SNAPSHOT_CEILING.player;
      expect({ viewer: v.label, over: v.bytes > ceiling }).toEqual({
        viewer: v.label,
        over: false,
      });
    }
  });
});
