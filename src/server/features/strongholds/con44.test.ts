// REM §12 / HOLD §12 / LOOT §12 sprint-9 CON-44 (ceilings DM 1.5 MiB since #256, players 512 KiB;
// never raised): the realistic-heavy harness on `session-sim`, then every RS row at its cap with
// max-length strings, written straight to the tables: 200 reminders (500-char text, 4 rolls,
// links), 8 strongholds × 24 facilities × 40 staff, every Stores with coin (8 `stores-coin`
// rows) and all 100 windowed loot entries with a hidden Stores end. Bounds from the specs:
// `reminder` / `stronghold` 0 B in every snapshot (lazy); `stronghold-index` ≤ 1.5 KB and
// `stores-coin` ≤ 2.5 KB per frame; DM `sync.load` acks ≤ 370 KB (reminders) / ≤ 380 KB
// (strongholds) at the caps.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { library } from "@fixtures/index";
import { LOOT_WINDOW, STORES_COIN_TYPE } from "@shared/party-loot/schemas";
import {
  REMINDER_ROLL_LABEL_MAX,
  REMINDER_SOURCE_MAX,
  REMINDER_TEXT_MAX,
  REMINDER_TYPE,
  REMINDERS_PER_CAMPAIGN,
} from "@shared/reminders/schemas";
import {
  FACILITIES_MAX,
  FACILITY_EFFECT_MAX,
  FACILITY_ORDER_MAX,
  HOLD_NAME_MAX,
  HOLD_NOTES_MAX,
  STAFF_MAX,
  STAFF_NOTES_MAX,
  STAFF_ROLE_MAX,
  STRONGHOLD_INDEX_TYPE,
  STRONGHOLD_TYPE,
  STRONGHOLDS_MAX,
} from "@shared/strongholds/schemas";
import { eq } from "drizzle-orm";
import {
  campaign,
  entity,
  lootEntry,
  lootEntrySeqNext,
  reminder,
  reminderSeqNext,
  stronghold,
  strongholdSeqNext,
} from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";
import { loadInProcess } from "../fixtures-adapters/loader";

const AT = "2026-10-23T20:00:00.000Z";
const x = (n: number, p = "") => (p + "x".repeat(n)).slice(0, n);
/** 36-char ids (as `ctx.ids`). */
const id36 = (p: string) => x(36, `${p}-`);
/** 59 chars: the longest canonical notation FR-DICE-01 lets us store. */
const LONG_EXPR = Array(6).fill("5d1000kh5").join("+");
const INDEX_MAX = 1_536;
const STORES_COIN_MAX = 2_560;
const REMINDER_LOAD_MAX = 370_000;
const STRONGHOLD_LOAD_MAX = 380_000;

/** An ack frame of `sync.load` carrying `records` (FR-SYNC-32). */
const ackBytes = (type: string, rows: unknown[]) =>
  Buffer.byteLength(
    JSON.stringify({
      type: "ack",
      intentId: id36("intent"),
      result: { records: { [type]: rows } },
    }),
    "utf8",
  );

describe("REM / HOLD §12 CON-44 at the caps", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let base: ViewerSize[];
  let after: ViewerSize[];
  /** Players' worst: the same window with every Stores end shown (a 36-char id, not `outside`). */
  let afterShown: ViewerSize[];
  let cid: string;

  beforeAll(async () => {
    b = await servicesFromBundle(await loadInProcess(library, "session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    base = snapshotSizes(b.s);
    const db = b.s.db;
    cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    const pcs = db
      .select()
      .from(entity)
      .where(eq(entity.campaignId, cid))
      .all()
      .filter((e) => e.kind === "character");
    // 8 strongholds at their caps, all shown (players get every index row and Stores).
    const holds: string[] = [];
    for (let h = 0; h < STRONGHOLDS_MAX; h++) {
      const hid = id36(`hold${h}`);
      holds.push(hid);
      const facilities = Array.from({ length: FACILITIES_MAX }, (_, i) => ({
        id: id36(`h${h}f${i}`),
        name: x(HOLD_NAME_MAX, `Facility ${h}.${i} `),
        state: "building" as const,
        cost: 999_999,
        buildDays: 999,
        upkeep: 99_999,
        incomeDice: LONG_EXPR,
        effect: x(FACILITY_EFFECT_MAX),
        order: x(FACILITY_ORDER_MAX),
        replacesId: i > 0 ? id36(`h${h}f${i - 1}`) : null,
        dmOnly: false,
      }));
      const staff = Array.from({ length: STAFF_MAX }, (_, i) => ({
        id: id36(`h${h}s${i}`),
        name: x(HOLD_NAME_MAX, `Staff ${h}.${i} `),
        role: x(STAFF_ROLE_MAX),
        wage: 99_999,
        notes: x(STAFF_NOTES_MAX),
        facilityId: id36(`h${h}f0`),
        dmOnly: false,
      }));
      db.insert(stronghold)
        .values({
          id: hid,
          campaignId: cid,
          seq: strongholdSeqNext,
          name: x(HOLD_NAME_MAX, `Stronghold ${h} `),
          dmOnly: false,
          defenders: 9_999,
          defendersDmOnly: false,
          notes: x(HOLD_NOTES_MAX),
          notesDmOnly: false,
          facilities,
          staff,
          createdAt: AT,
          updatedAt: AT,
        })
        .run();
    }
    // 200 reminders at max length, linked, spread over the party and the PCs.
    for (let i = 0; i < REMINDERS_PER_CAMPAIGN; i++) {
      const pc = i % 3 === 0 ? null : (pcs[i % pcs.length] ?? null);
      const h = i % STRONGHOLDS_MAX;
      db.insert(reminder)
        .values({
          id: id36(`rem${i}`),
          campaignId: cid,
          seq: reminderSeqNext,
          characterId: pc?.id ?? null,
          text: x(REMINDER_TEXT_MAX),
          source: x(REMINDER_SOURCE_MAX),
          rolls: Array.from({ length: 4 }, (_, r) => ({
            id: id36(`rem${i}r${r}`),
            label: x(REMINDER_ROLL_LABEL_MAX),
            expression: LONG_EXPR,
            category: "saving-throw" as const,
          })),
          strongholdId: holds[h] as string,
          facilityId: id36(`h${h}f${i % FACILITIES_MAX}`),
          dmOnly: false,
          ownerPlayerId: pc?.ownerPlayerId ?? null,
          linkHidden: false,
          createdByPlayerId: null,
          createdAt: AT,
          updatedAt: AT,
        })
        .run();
    }
    // The whole loot window with a hidden Stores end (worst width): DM `stores` + `storesHidden`.
    for (let i = 0; i < LOOT_WINDOW; i++)
      db.insert(lootEntry)
        .values({
          id: id36(`stores-entry${i}`),
          campaignId: cid,
          seq: lootEntrySeqNext,
          kind: "move",
          fromKind: "stores",
          fromCharacterId: null,
          fromStrongholdId: holds[i % STRONGHOLDS_MAX] as string,
          toKind: "party",
          toCharacterId: null,
          toStrongholdId: null,
          text: x(100),
          cp: 999_999,
          sp: 999_999,
          ep: 999_999,
          gp: 999_999,
          pp: 999_999,
          qty: null,
          storesHidden: true,
          itemHidden: false,
          createdAt: AT,
          editedAt: null,
        })
        .run();
    after = snapshotSizes(b.s);
    db.update(lootEntry).set({ storesHidden: false }).where(eq(lootEntry.fromKind, "stores")).run();
    afterShown = snapshotSizes(b.s);
  });

  afterAll(() => b.cleanup());

  test("FR-REM-29 CON-44: reminders absent from every snapshot; DM load ≤ 370 KB at the cap", () => {
    for (const v of after) expect([v.label, v.types[REMINDER_TYPE]]).toEqual([v.label, undefined]);
    const src = { db: b.s.db, presence: { list: () => [] } };
    const dm = { connId: "dm", campaignId: cid, role: "dm" as const, playerId: null };
    const rows = b.s.records.load(src, dm, REMINDER_TYPE)[REMINDER_TYPE] ?? [];
    expect(rows).toHaveLength(REMINDERS_PER_CAMPAIGN);
    const bytes = ackBytes(REMINDER_TYPE, rows);
    console.log(`FR-REM-29 reminder load at the cap: DM ${bytes} B`);
    expect(bytes).toBeLessThanOrEqual(REMINDER_LOAD_MAX);
  });

  test("FR-HOLD-37 CON-44: both ceilings; 0 B for `stronghold`; index ≤ 1.5 KB; stores-coin ≤ 2.5 KB; DM load ≤ 380 KB", () => {
    for (const v of after) {
      const ceiling = v.role === "dm" ? SNAPSHOT_CEILING.dm : SNAPSHOT_CEILING.player;
      expect({ viewer: v.label, over: v.bytes > ceiling }).toEqual({
        viewer: v.label,
        over: false,
      });
      expect([v.label, v.types[STRONGHOLD_TYPE]]).toEqual([v.label, undefined]);
      expect(v.types[STRONGHOLD_INDEX_TYPE]?.bytes ?? 0).toBeLessThanOrEqual(INDEX_MAX);
      expect(v.types[STORES_COIN_TYPE]?.bytes ?? 0).toBeLessThanOrEqual(STORES_COIN_MAX);
    }
    const dmAfter = after[0] as ViewerSize;
    const dmBase = base[0] as ViewerSize;
    expect(dmAfter.types[STRONGHOLD_INDEX_TYPE]?.rows).toBe(STRONGHOLDS_MAX);
    expect(dmAfter.types[STORES_COIN_TYPE]?.rows).toBe(STRONGHOLDS_MAX);
    const src = { db: b.s.db, presence: { list: () => [] } };
    const dm = { connId: "dm", campaignId: cid, role: "dm" as const, playerId: null };
    const load = ackBytes(
      STRONGHOLD_TYPE,
      b.s.records.load(src, dm, STRONGHOLD_TYPE)[STRONGHOLD_TYPE] ?? [],
    );
    expect(load).toBeLessThanOrEqual(STRONGHOLD_LOAD_MAX);
    const players = afterShown.slice(1);
    const deltas = players.map((p, i) => p.bytes - (base[i + 1] as ViewerSize).bytes);
    console.log(
      [
        `CON-44 RS at the caps: DM ${dmBase.bytes} → ${dmAfter.bytes} B (+${dmAfter.bytes - dmBase.bytes}; ${SNAPSHOT_CEILING.dm - dmAfter.bytes} B left of 1.5 MiB)`,
        `index DM ${dmAfter.types[STRONGHOLD_INDEX_TYPE]?.bytes} B / player ${players[0]?.types[STRONGHOLD_INDEX_TYPE]?.bytes} B`,
        `stores-coin DM ${dmAfter.types[STORES_COIN_TYPE]?.bytes} B / player ${players[0]?.types[STORES_COIN_TYPE]?.bytes} B`,
        `players +${Math.min(...deltas)}…+${Math.max(...deltas)} B (max ${Math.max(...players.map((p) => p.bytes))} B of 512 KiB)`,
        `stronghold load DM ${load} B`,
      ].join("; "),
    );
    // LOOT §12 / HOLD §12: DM ≤ +11.5 KB, players ≤ +9.2 KB worst.
    expect(dmAfter.bytes - dmBase.bytes).toBeLessThanOrEqual(11_500);
    for (const d of deltas) expect(d).toBeLessThanOrEqual(9_200);
  });
});
