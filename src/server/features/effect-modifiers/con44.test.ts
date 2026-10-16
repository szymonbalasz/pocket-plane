// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// MOD §12 / §13 CON-44 for sprint 3 (R0; #208 ceilings: DM 1 MiB, players 512 KiB, no headroom
// guard): the realistic-heavy harness plus every R row MOD §12 lists, at max length, written
// straight to the tables (the commands come in R1 / R4): tier-2 modifiers on presets and
// modifier effects, `originKey` on every preset, one max offered part with settle facts on each
// pending card, the damage `roll` item's `offered` (20 dice) + its DM name on 30 attack entries,
// a typed trigger part on 30 outcome lines, `triggerParts` on the applied rows. `rule-trigger`
// rows (campaign cap, 40) stay out of every snapshot (lazy, ADR-0045); `trigger_use` is
// server-only. MOD's bounds: R rows ≤ 40 KiB DM / ≤ 20 KiB per player, load ack ≤ 48 KiB.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { LOG_KIND_ATTACK } from "@shared/combat-tracker/schemas";
import type { RollEntryDmPayload, RollEntryPayload } from "@shared/dice-roll-log/schemas";
import { BUILTIN_PRESET_KEYS } from "@shared/effect-modifiers/schemas";
import {
  CAMPAIGN_TRIGGERS_MAX,
  CHARACTER_TRIGGERS_MAX,
  RULE_TRIGGER_TYPE,
} from "@shared/effect-modifiers/trigger-records";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { and, eq, ne } from "drizzle-orm";
import {
  campaign,
  effect,
  effectPreset,
  entity,
  gameLogEntry,
  hpChange,
  notification,
  ruleTrigger,
  ruleTriggerSeqNext,
} from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import { RecordRegistry, type Viewer } from "../../ws/records";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";
import { ruleTriggerRecordType } from "./trigger-records";

/** MOD §12 bounds. */
const R_DM_MAX = 40 * 1024;
const R_PLAYER_MAX = 20 * 1024;
const LOAD_ACK_MAX = 48 * 1024;
const AT = "2026-01-01T00:00:00.000Z";

/** Exactly `n` chars (max-length ASCII strings, as the harness). */
const x = (n: number, p = "") => (p + "x".repeat(n)).slice(0, n);
const uuid = (p: string) => x(36, `${p}-`);
const ALL_TYPES = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder",
];
/** Tier 2 at max (MOD §12): `defense` with all 13 types. */
const DEFENSE = { kind: "defense", types: ALL_TYPES, level: "vulnerability" };
const LONGEST_KEY = [...BUILTIN_PRESET_KEYS].sort((a, b) => b.length - a.length)[0] as string;

/** A 60-char formula (§8.5's cap). */
const FORMULA_60 = "1d6 + floor(level(barbarian) / 2) + max(str, dex) + prof + 1";

/** A max rule (§8.4): requires, 6 filters (a 4-name `row`, soft mode, mark, ask), 60-char formula. */
const maxRule = (i: number): TriggerRule => ({
  on: "hit",
  requires: { preset: uuid(`pr${i}`) },
  when: [
    { if: "via", via: "weapon" },
    {
      if: "row",
      names: [x(40, "Greataxe "), x(40, "Handaxe "), x(40, "Javelin "), x(40, "Maul ")],
    },
    { if: "ownTurn" },
    { if: "mode", modes: ["normal", "advantage", "disadvantage"], soft: true },
    { if: "targetMarked", preset: uuid(`mk${i}`) },
    { if: "ask", note: x(60, "Check: ") },
  ],
  every: "turn",
  then: { do: "damage", formula: FORMULA_60, type: "lightning" },
});

const sum = (sizes: ViewerSize[]) => sizes.map((s) => s.bytes);

describe("CON-44 with MOD sprint-3 rows (MOD §12, #208)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let before: number[];
  let beforeTypes: ViewerSize["types"][];
  let after: ViewerSize[];
  /** + `hp_change.triggerParts` on the applied rows (not in MOD §12's table; DM only). */
  let withParts: ViewerSize[];
  let cid: string;
  beforeAll(async () => {
    b = await servicesFromBundle(await loadBundle("session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    const db = b.s.db;
    cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    const base = snapshotSizes(b.s);
    before = sum(base);
    beforeTypes = base.map((v) => v.types);

    // Tier 2: every preset 6 max `defense` modifiers; `originKey` (the longest built-in key) on
    // every preset that doesn't customise one.
    for (const p of db.select().from(effectPreset).all()) {
      db.update(effectPreset)
        .set({
          modifiers: Array(6).fill(DEFENSE) as never,
          originKey: p.key === null ? LONGEST_KEY : null,
        })
        .where(eq(effectPreset.id, p.id))
        .run();
    }
    // Tier 2: the modifier effects carry 2 max `defense` modifiers.
    for (const e of db.select().from(effect).all()) {
      if ((e.modifiers as unknown[]).length === 0) continue;
      db.update(effect)
        .set({ modifiers: [DEFENSE, DEFENSE] as never })
        .where(eq(effect.id, e.id))
        .run();
    }
    // Card offered parts: one max part with settle facts on each pending card.
    const offer = {
      triggerId: uuid("trg"),
      label: x(40, "Divine Fury "),
      value: 99,
      expression: x(20, "20d12+"),
      rollId: uuid("roll"),
      type: "lightning",
      auto: true,
      ask: x(60, "Check: "),
      marked: uuid("mk"),
      hurt: true,
      untick: true,
    };
    const pending = db
      .select()
      .from(notification)
      .where(and(eq(notification.kind, "damage-card"), eq(notification.state, "pending")))
      .all();
    for (const n of pending) {
      const p = n.payload as { damage: Record<string, unknown> | null };
      if (!p.damage) continue;
      db.update(notification)
        .set({ payload: { ...p, damage: { ...p.damage, triggers: [offer] } } })
        .where(eq(notification.id, n.id))
        .run();
    }
    // Damage `roll` items with 1 max `offered` part (20 dice) + its DM name (R1): the attacks'
    // two-item entries.
    const rollEntries = db.select().from(gameLogEntry).where(eq(gameLogEntry.kind, "roll")).all();
    let attacks = 0;
    for (const e of rollEntries) {
      const items = e.payload as RollEntryPayload;
      if (items.length !== 2 || attacks >= 30) continue;
      attacks++;
      const offered = {
        label: x(40, "Divine Fury "),
        value: 99,
        expression: x(20, "20d12+"),
        rollId: uuid("roll"),
        type: "lightning",
        auto: true,
        dice: Array(20).fill(12),
      };
      const dm = (e.dmPayload as RollEntryDmPayload | null) ?? {
        items: items.map(() => ({ mods: [] })),
      };
      db.update(gameLogEntry)
        .set({
          payload: [items[0], { ...items[1], offered: [offered] }],
          dmPayload: {
            ...dm,
            items: dm.items.map((it, i) =>
              i === 1
                ? { ...it, offered: [{ triggerId: uuid("trg"), label: x(40, "Divine Fury ") }] }
                : it,
            ),
          },
        })
        .where(eq(gameLogEntry.id, e.id))
        .run();
    }
    expect(attacks).toBe(30);
    // Outcome lines with a typed trigger part (+ the DM's facts) and the rows' `triggerParts`.
    const lines = db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.kind, LOG_KIND_ATTACK))
      .all();
    for (const l of lines) {
      db.update(gameLogEntry)
        .set({
          payload: {
            ...(l.payload as object),
            parts: [{ label: x(40, "Divine Fury "), value: 99, type: "lightning" }],
          },
          dmPayload: {
            ...(l.dmPayload as object),
            parts: [
              { triggerId: uuid("trg"), label: x(40, "Divine Fury "), rolled: 99, forced: true },
            ],
          },
        })
        .where(eq(gameLogEntry.id, l.id))
        .run();
    }
    after = snapshotSizes(b.s);
    db.update(hpChange)
      .set({
        triggerParts: [
          {
            triggerId: uuid("trg"),
            name: x(40, "Divine Fury "),
            value: 99,
            multiplier: "double",
            type: "lightning",
            forced: true,
          },
        ],
      })
      .run();
    // `rule-trigger` at the campaign cap: 6 per PC, the rest on monster definitions.
    const pcs = db
      .select()
      .from(entity)
      .where(
        and(eq(entity.campaignId, cid), eq(entity.kind, "character"), ne(entity.ownerPlayerId, "")),
      )
      .all()
      .filter((e) => e.ownerPlayerId !== null);
    const monsters = db
      .select()
      .from(entity)
      .where(and(eq(entity.campaignId, cid), eq(entity.kind, "monster")))
      .all();
    let n = 0;
    const trigger = (v: Partial<typeof ruleTrigger.$inferInsert>) =>
      db
        .insert(ruleTrigger)
        .values({
          id: uuid(`t${++n}`),
          campaignId: cid,
          seq: ruleTriggerSeqNext,
          name: x(40, `Trigger ${n} `),
          public: true,
          rule: maxRule(n),
          updatedAt: AT,
          ...v,
        })
        .run();
    for (const pc of pcs) {
      for (let i = 0; i < CHARACTER_TRIGGERS_MAX && n < CAMPAIGN_TRIGGERS_MAX; i++) {
        trigger({ characterId: pc.id, ownerPlayerId: pc.ownerPlayerId });
      }
    }
    for (let i = 0; n < CAMPAIGN_TRIGGERS_MAX; i++) {
      trigger({ definitionId: monsters[i % monsters.length]?.id as string, public: false });
    }
    withParts = snapshotSizes(b.s);
  }, 60_000);
  afterAll(() => b.cleanup());

  test("CON-44 MOD §12 heavy (#208): DM < 1 MiB, players < 512 KiB; R rows ≤ 40 KiB DM, ≤ 20 KiB per player", () => {
    const [dm, ...players] = after;
    const dmDelta = (dm?.bytes ?? 0) - (before[0] ?? 0);
    const deltas = players.map((p, i) => p.bytes - (before[i + 1] ?? 0));
    const typeDelta = (i: number) =>
      Object.entries(after[i]?.types ?? {})
        .map(([k, v]) => [k, v.bytes - (beforeTypes[i]?.[k]?.bytes ?? 0)] as const)
        .filter(([, d]) => d !== 0)
        .map(([k, d]) => `${k} +${d}`)
        .join(", ");
    console.log(`MOD CON-44 (R0): DM per type ${typeDelta(0)}; P1 ${typeDelta(1)}`);
    const partsDelta = (withParts[0]?.bytes ?? 0) - (dm?.bytes ?? 0);
    console.log(
      `MOD CON-44 (R0): + hp_change.triggerParts (1 max part on every applied row): DM +${partsDelta} → ${withParts[0]?.bytes} B; players +${Math.max(...withParts.slice(1).map((p, i) => p.bytes - (players[i]?.bytes ?? 0)))}`,
    );
    expect(withParts[0]?.bytes ?? Infinity).toBeLessThan(SNAPSHOT_CEILING.dm);
    for (const [i, p] of withParts.slice(1).entries())
      expect(p.bytes).toBe(players[i]?.bytes ?? -1);
    console.log(
      `MOD CON-44 (R0): heavy DM ${before[0]} → ${dm?.bytes} B (+${dmDelta}; ${SNAPSHOT_CEILING.dm - (dm?.bytes ?? 0)} B left of 1 MiB); players max ${Math.max(...players.map((p) => p.bytes))} B (+${Math.min(...deltas)}…+${Math.max(...deltas)})`,
    );
    expect(dm?.bytes ?? Infinity).toBeLessThan(SNAPSHOT_CEILING.dm);
    expect(dmDelta).toBeGreaterThan(0);
    expect(dmDelta).toBeLessThanOrEqual(R_DM_MAX);
    for (const [i, p] of players.entries()) {
      expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
      expect(deltas[i] ?? Infinity).toBeLessThanOrEqual(R_PLAYER_MAX);
    }
  });

  test("FR-MOD-47 no `rule-trigger` in any snapshot frame (lazy, ADR-0045); trigger_use / window never on any wire", () => {
    expect(b.s.db.select().from(ruleTrigger).all()).toHaveLength(CAMPAIGN_TRIGGERS_MAX);
    for (const f of snapshotFrames(b.s)) {
      expect(f.records[RULE_TRIGGER_TYPE]).toBeUndefined();
      const text = JSON.stringify(f.records);
      expect(text).not.toContain("ownerCombatantId");
      expect(text).not.toContain("trigger_use");
    }
  });

  test("FR-MOD-47 load ack at the campaign cap ≤ 48 KiB (DM, every row); a player's own rows", () => {
    // The `sync.load {type: "rule-trigger"}` ack once R4 registers the type: the filtered rows.
    const reg = new RecordRegistry();
    reg.register(ruleTriggerRecordType);
    const frames = snapshotFrames(b.s);
    const ack = (v: Viewer) => {
      const records = reg.load({ db: b.s.db, presence: { list: () => [] } }, v, RULE_TRIGGER_TYPE);
      const rows = (records[RULE_TRIGGER_TYPE] ?? []) as { definitionId: string | null }[];
      return {
        rows: rows.length,
        definitions: rows.filter((r) => r.definitionId !== null).length,
        bytes: Buffer.byteLength(
          JSON.stringify({ type: "ack", intentId: uuid("intent"), result: { records } }),
          "utf8",
        ),
      };
    };
    const dm = ack(frames[0]?.viewer as Viewer);
    expect(dm.rows).toBe(CAMPAIGN_TRIGGERS_MAX);
    expect(dm.bytes).toBeLessThanOrEqual(LOAD_ACK_MAX);
    const players = frames.slice(1).map((f) => ack(f.viewer));
    console.log(
      `MOD CON-44 (R0): rule-trigger load ack DM ${dm.rows} rows ${dm.bytes} B (${Math.round(dm.bytes / dm.rows)} B/row); player max ${Math.max(...players.map((p) => p.rows))} rows ${Math.max(...players.map((p) => p.bytes))} B`,
    );
    // A player gets their own characters' rows (≤ 6 each), never a definition's.
    for (const p of players) {
      expect(p.definitions).toBe(0);
      expect(p.bytes).toBeLessThanOrEqual(LOAD_ACK_MAX);
    }
    expect(players.reduce((n, p) => n + p.rows, 0)).toBe(dm.rows - dm.definitions);
  });
});
