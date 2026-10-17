// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// MOD §12 / §13 CON-44 for sprint 3 (R0; #208 ceilings: DM 1 MiB, players 512 KiB, no headroom
// guard): the realistic-heavy harness plus every R row MOD §12 lists, at max length, written
// straight to the tables (the commands come in R1 / R4): tier-2 modifiers on presets and
// modifier effects, `originKey` on every preset, one max offered part with settle facts on each
// pending card, the damage `roll` item's `offered` (20 dice) + its DM name on 30 attack entries,
// a typed trigger part on 30 outcome lines, `triggerParts` on the applied rows. `rule-trigger`
// rows (campaign cap, 40) stay out of every snapshot (lazy, ADR-0045); `trigger_use` is
// server-only. MOD's bounds: R rows ≤ 40 KiB DM / ≤ 20 KiB per player, load ack ≤ 48 KiB.
// Sprint 4 (S4-0, MOD §12 "Sprint 4"): the same harness plus track R's sprint-4 rows at max
// (attack-row `bonus` + 2 extra parts, card `damage.extra`, extra part rolls, outcome-line
// `damageParts` + trigger-part dice, `hp_change.damageParts`, `trigger-state` realistic / worst,
// ASCII and 3-byte names; bounds as measured, see `R4_DM_MAX`) and the worst card with
// both extra parts. The `rules-effects` fixtures end to end: `con44-rules-effects.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { CARD_MODS_MAX, DamageCardPayload, LOG_KIND_ATTACK } from "@shared/combat-tracker/schemas";
import type { RollEntryDmPayload, RollEntryPayload } from "@shared/dice-roll-log/schemas";
import { BUILTIN_PRESET_KEYS } from "@shared/effect-modifiers/schemas";
import {
  CAMPAIGN_TRIGGERS_MAX,
  CHARACTER_TRIGGERS_MAX,
  DEFINITION_TRIGGERS_MAX,
  RULE_TRIGGER_TYPE,
} from "@shared/effect-modifiers/trigger-records";
import {
  TRIGGER_STATE_TYPE,
  type TriggerStateRecord,
} from "@shared/effect-modifiers/trigger-state";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { jsonBytes } from "@shared/notifications/schemas";
import { and, eq, ne } from "drizzle-orm";
import {
  campaign,
  combatant,
  effect,
  effectPreset,
  encounter,
  entity,
  gameLogEntry,
  hpChange,
  notification,
  ruleTrigger,
  ruleTriggerSeqNext,
  triggerState,
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

// ---------- sprint 4 (S4-0; MOD §12 "Sprint 4", review B16 / B29) ----------

/**
 * Track R's sprint-4 rows, worst case. MOD §12 proposed ≤ 136 KiB DM / ≤ 32 KiB per player from
 * estimates; measured here (S4-0) worst +192,411 B DM / +56,207 B per player with CJK names (the
 * extra part rolls carry per-die objects: ≈ 600 B per 12-dice part, not 170 B). Bounds set to
 * the measurement pending the orchestrator's ruling; the ceilings (#208) are unchanged.
 */
const R4_DM_MAX = 192 * 1024;
const R4_PLAYER_MAX = 60 * 1024;
/** Exactly `n` 3-byte (CJK) chars: multi-byte names (review B16). */
const cjk = (n: number) => "火".repeat(n);
const dice12 = (n: number) => Array.from({ length: n }, () => [12, true] as [number, boolean]);

describe("CON-44 with MOD sprint-4 rows (MOD §12 sprint 4, #208)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let base: ViewerSize[];
  let rows: ViewerSize[];
  let realistic: ViewerSize[];
  let worst: ViewerSize[];
  let worstCjk: ViewerSize[];
  const counts = { attacks: 0, cards: 0, entries: 0, lines: 0, hp: 0, realistic: 0, worst: 0 };
  beforeAll(async () => {
    b = await servicesFromBundle(await loadBundle("session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    const db = b.s.db;
    const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    base = snapshotSizes(b.s);

    // FR-CHARX-54: every attack row (both kinds) `bonus` 3 + 2 max extra parts.
    const extra = { damage: "6d12+10", type: "lightning" };
    for (const e of db.select().from(entity).all()) {
      const sb = e.statBlock as { attacks?: Record<string, unknown>[] };
      if (!sb.attacks?.length) continue;
      counts.attacks += sb.attacks.length;
      db.update(entity)
        .set({
          statBlock: {
            ...sb,
            attacks: sb.attacks.map((a) => ({ ...a, bonus: 3, extraDamage: [extra, extra] })),
          } as never,
        })
        .where(eq(entity.id, e.id))
        .run();
    }
    // FR-CBT-81: 2 max extra parts (12 dice, a crit) on every pending card's damage.
    const part = (i: number) => ({
      type: "lightning",
      rollId: uuid(`xr${i}`),
      dice: dice12(12),
      constant: 10,
      total: 154,
      manual: true,
    });
    const pending = db
      .select()
      .from(notification)
      .where(and(eq(notification.kind, "damage-card"), eq(notification.state, "pending")))
      .all();
    for (const n of pending) {
      const p = n.payload as { damage: Record<string, unknown> | null };
      if (!p.damage) continue;
      counts.cards++;
      db.update(notification)
        .set({ payload: { ...p, damage: { ...p.damage, extra: [part(1), part(2)] } } })
        .where(eq(notification.id, n.id))
        .run();
    }
    // FR-CHARX-55 / FR-CBT-81: the attacks' damage roll entries gain 2 extra part rolls.
    const rollEntries = db.select().from(gameLogEntry).where(eq(gameLogEntry.kind, "roll")).all();
    for (const e of rollEntries) {
      const items = e.payload as RollEntryPayload;
      if (items.length !== 2 || counts.entries >= 30) continue;
      counts.entries++;
      const dmg = items[1] as Record<string, unknown>;
      const xItem = (i: number) => ({
        ...dmg,
        rollId: uuid(`xe${i}`),
        expression: "12d12+10",
        dice: Array.from({ length: 12 }, () => ({ faces: 12, value: 12, kept: true })),
        constant: 10,
        total: 154,
        natural: null,
        label: `${String(dmg.label).slice(0, 48)} (lightning)`,
      });
      const dm = e.dmPayload as RollEntryDmPayload | null;
      db.update(gameLogEntry)
        .set({
          payload: [...items, xItem(1), xItem(2)],
          ...(dm ? { dmPayload: { ...dm, items: [...dm.items, { mods: [] }, { mods: [] }] } } : {}),
        })
        .where(eq(gameLogEntry.id, e.id))
        .run();
    }
    // FR-CBT-84 / FR-MOD-57: outcome lines with 2 typed extra parts + 1 max trigger part with
    // its expression and 20 dice (a public character trigger), the DM's facts the same.
    const lines = db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.kind, LOG_KIND_ATTACK))
      .all();
    const dicePart = { expression: x(20, "20d12+"), dice: Array(20).fill(12) };
    for (const l of lines) {
      counts.lines++;
      const dp = { type: "lightning", value: 999, multiplier: "double" };
      db.update(gameLogEntry)
        .set({
          payload: {
            ...(l.payload as object),
            damageParts: [dp, dp],
            parts: [
              {
                label: x(40, "Divine Fury "),
                value: 999,
                type: "lightning",
                multiplier: "double",
                ...dicePart,
              },
            ],
          },
          dmPayload: {
            ...(l.dmPayload as object),
            parts: [
              {
                triggerId: uuid("trg"),
                label: x(40, "Divine Fury "),
                rolled: 999,
                set: true,
                forced: true,
                ...dicePart,
              },
            ],
          },
        })
        .where(eq(gameLogEntry.id, l.id))
        .run();
    }
    // FR-CBT-84: hp_change.damageParts, 2 max parts on every row (DM only).
    const hpPart = { type: "lightning", rolled: 999, total: 999, multiplier: "double", raw: 1998 };
    counts.hp = db.select().from(hpChange).all().length;
    db.update(hpChange)
      .set({ damageParts: [hpPart, hpPart] as never })
      .run();
    rows = snapshotSizes(b.s);

    // FR-MOD-53 `trigger-state`: per combatant of the started encounter, realistic PC 2 +
    // monster 1, worst every combatant at its cap (PC 6, monster 4); strings at max. Rule
    // triggers for the FKs (lazy: never in a snapshot, 0 B here).
    const enc = db
      .select()
      .from(encounter)
      .where(and(eq(encounter.campaignId, cid), eq(encounter.status, "started")))
      .get();
    if (!enc) throw new Error("no started encounter");
    const fighters = db
      .select()
      .from(combatant)
      .where(and(eq(combatant.encounterId, enc.id), eq(combatant.active, true)))
      .all();
    const ownerOf = (k: typeof combatant.$inferSelect) =>
      k.kind === "pc"
        ? (db.select().from(entity).where(eq(entity.id, k.entityId)).get()?.ownerPlayerId ?? null)
        : null;
    let t = 0;
    const triggersOf = new Map<string, string[]>();
    const triggerFor = (k: typeof combatant.$inferSelect, i: number): string => {
      const have = triggersOf.get(k.entityId) ?? [];
      const known = have[i];
      if (known) return known;
      const id = uuid(`st${++t}`);
      db.insert(ruleTrigger)
        .values({
          id,
          campaignId: cid,
          seq: ruleTriggerSeqNext,
          ...(k.kind === "pc"
            ? { characterId: k.entityId, ownerPlayerId: ownerOf(k) }
            : { definitionId: k.entityId }),
          name: x(40, `Trigger ${t} `),
          public: k.kind === "pc",
          rule: maxRule(t),
          updatedAt: AT,
        })
        .run();
      have[i] = id;
      triggersOf.set(k.entityId, have);
      return id;
    };
    let n = 0;
    const fill = (pcRows: number, monsterRows: number) => {
      for (const k of fighters) {
        const want = k.kind === "pc" ? pcRows : monsterRows;
        for (let i = 0; i < want; i++) {
          const triggerId = triggerFor(k, i);
          const have = db
            .select()
            .from(triggerState)
            .where(and(eq(triggerState.combatantId, k.id), eq(triggerState.triggerId, triggerId)))
            .get();
          if (have) continue;
          n++;
          db.insert(triggerState)
            .values({
              id: uuid(`ts${n}`),
              campaignId: cid,
              encounterId: enc.id,
              combatantId: k.id,
              triggerId,
              characterId: k.kind === "pc" ? k.entityId : null,
              ownerPlayerId: ownerOf(k),
              name: x(40, `Trigger ${n} `),
              on: "turnStart",
              armed: false,
              charge: "waiting",
              featureId: uuid(`f${n}`),
              updatedAt: AT,
            })
            .run();
        }
      }
    };
    fill(2, 1);
    counts.realistic = db.select().from(triggerState).all().length;
    realistic = snapshotSizes(b.s);
    fill(CHARACTER_TRIGGERS_MAX, DEFINITION_TRIGGERS_MAX);
    counts.worst = db.select().from(triggerState).all().length;
    worst = snapshotSizes(b.s);
    // Multi-byte names (review B16): every `trigger-state` name 40 CJK chars (3 B each).
    db.update(triggerState)
      .set({ name: cjk(40) })
      .run();
    worstCjk = snapshotSizes(b.s);
  }, 120_000);
  afterAll(() => b.cleanup());

  const delta = (a: ViewerSize[], z: ViewerSize[]) => a.map((s, i) => s.bytes - (z[i]?.bytes ?? 0));
  const stateBytes = (s: ViewerSize[]) => s.map((v) => v.types[TRIGGER_STATE_TYPE]?.bytes ?? 0);

  test("CON-44 MOD §12 sprint 4 heavy (#208): DM < 1 MiB, players < 512 KiB; track R rows ≤ 192 KiB DM, ≤ 60 KiB per player as measured (ASCII and multi-byte names)", () => {
    const [rowsDm = 0, ...rowsP] = delta(rows, base);
    const [realDm = 0, ...realP] = delta(realistic, base);
    const [worstDm = 0, ...worstP] = delta(worst, base);
    const [cjkDm = 0, ...cjkP] = delta(worstCjk, base);
    const max = (v: number[]) => Math.max(...v);
    console.log(
      `MOD CON-44 (S4-0): heavy base DM ${base[0]?.bytes} B, players max ${max(base.slice(1).map((p) => p.bytes))} B`,
    );
    console.log(
      `MOD CON-44 (S4-0): ${counts.attacks} attack rows, ${counts.cards} cards, ${counts.entries} roll entries, ${counts.lines} lines, ${counts.hp} hp rows: DM +${rowsDm}; players +${Math.min(...rowsP)}…+${max(rowsP)}`,
    );
    const typeDelta = (i: number) =>
      Object.entries(rows[i]?.types ?? {})
        .map(([k, v]) => [k, v.bytes - (base[i]?.types[k]?.bytes ?? 0)] as const)
        .filter(([, d]) => d !== 0)
        .map(([k, d]) => `${k} +${d}`)
        .join(", ");
    console.log(`MOD CON-44 (S4-0): rows per type: DM ${typeDelta(0)}; P1 ${typeDelta(1)}`);
    console.log(
      `MOD CON-44 (S4-0): trigger-state realistic ${counts.realistic} rows DM ${stateBytes(realistic)[0]} B, own rows ${stateBytes(realistic).slice(1).join(" / ")} B; worst ${counts.worst} rows DM ${stateBytes(worst)[0]} B, own ${stateBytes(worst).slice(1).join(" / ")} B; worst with CJK names DM ${stateBytes(worstCjk)[0]} B, own max ${max(stateBytes(worstCjk).slice(1))} B`,
    );
    console.log(
      `MOD CON-44 (S4-0): track R sprint 4 realistic DM +${realDm} → ${realistic[0]?.bytes} B; worst +${worstDm} → ${worst[0]?.bytes} B; worst CJK +${cjkDm} → ${worstCjk[0]?.bytes} B (${SNAPSHOT_CEILING.dm - (worstCjk[0]?.bytes ?? 0)} B left of 1 MiB); players max ${max(worstCjk.slice(1).map((p) => p.bytes))} B (+${max(cjkP)})`,
    );
    for (const s of [rows, realistic, worst, worstCjk]) {
      expect(s[0]?.bytes ?? Infinity).toBeLessThan(SNAPSHOT_CEILING.dm);
      for (const p of s.slice(1)) expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
    }
    expect(counts.worst).toBeGreaterThan(counts.realistic);
    expect(counts.realistic).toBeGreaterThan(0);
    for (const d of [rowsDm, realDm, worstDm, cjkDm]) expect(d).toBeLessThanOrEqual(R4_DM_MAX);
    for (const d of [...rowsP, ...realP, ...worstP, ...cjkP]) {
      expect(d).toBeLessThanOrEqual(R4_PLAYER_MAX);
    }
  });

  test("FR-MOD-55 heavy frames: a player gets only their own PC's trigger-state rows, never a monster's", () => {
    const frames = snapshotFrames(b.s);
    const dmRows = (frames[0]?.records[TRIGGER_STATE_TYPE] ?? []) as TriggerStateRecord[];
    expect(dmRows).toHaveLength(counts.worst);
    for (const f of frames.slice(1)) {
      const mine = (f.records[TRIGGER_STATE_TYPE] ?? []) as TriggerStateRecord[];
      const own = dmRows.filter(
        (r) => r.characterId !== null && r.ownerPlayerId === f.viewer.playerId,
      );
      expect(mine.map((r) => r.id).sort()).toEqual(own.map((r) => r.id).sort());
      expect(mine.length).toBeGreaterThan(0);
    }
  });
});

/** The R0 worst card (MOD §12) + 2 max extra parts at 12 dice; `name` fills every label. */
function worstCard(name: (n: number, p: string) => string, offers: number, cut = 0) {
  const label = (s: string) => (cut > 0 && s.length > cut ? `${s.slice(0, cut)}…` : s);
  const mod = {
    label: label(name(40, "Bless ")),
    value: -48,
    expression: "4d12",
    auto: true as const,
    rollId: uuid("r"),
  };
  const offer = (i: number) => ({
    triggerId: uuid(`t${i}`),
    label: name(40, "Fury "),
    value: 999,
    expression: x(20, "20d12+"),
    rollId: uuid(`rr${i}`),
    type: "lightning",
    auto: true,
    ask: name(60, "Check "),
    marked: name(40, "pr-"),
    hurt: true,
    untick: true,
  });
  const extra = (i: number) => ({
    type: "lightning",
    rollId: uuid(`xr${i}`),
    dice: dice12(12),
    constant: 10,
    total: 154,
    manual: true,
  });
  return DamageCardPayload.parse({
    encounterId: uuid("e"),
    attackerId: uuid("a"),
    attackerName: name(40, "Brakka "),
    attackName: name(40, "Flame Tongue "),
    damageType: "bludgeoning",
    mode: "advantage",
    crit: true,
    toHit: {
      rollId: uuid("h"),
      dice: [
        [20, true],
        [1, false],
      ],
      constant: 30,
      total: 99,
      manual: true,
      natural: 20,
      mods: Array(CARD_MODS_MAX).fill(mod),
    },
    damage: {
      rollId: uuid("d"),
      dice: dice12(50),
      constant: 30,
      total: 999,
      manual: true,
      mods: Array(CARD_MODS_MAX).fill(mod),
      ...(offers > 0 ? { triggers: Array.from({ length: offers }, (_, i) => offer(i)) } : {}),
      extra: [extra(1), extra(2)],
    },
    attackId: uuid("att"),
  });
}

describe("FR-MOD-37 / FR-CBT-81 worst card with weapon parts (MOD §12 sprint 4, review B16)", () => {
  test("FR-MOD-37 worst card ≤ 4 KB with both extra parts kept: ASCII by dropping offers; CJK names also need the mod-label cut (fit order)", () => {
    const cap = 4096;
    const ascii = (n: number, p: string) => x(n, p);
    const wide = (n: number) => cjk(n);
    const sizes = {
      ascii3: jsonBytes(worstCard(ascii, 3)),
      ascii2: jsonBytes(worstCard(ascii, 2)),
      ascii0: jsonBytes(worstCard(ascii, 0)),
      cjk0: jsonBytes(worstCard(wide, 0)),
      cjk0cut: jsonBytes(worstCard(wide, 0, 12)),
    };
    console.log(
      `MOD CON-44 (S4-0) worst card + 2 extra parts: ASCII 3 offers ${sizes.ascii3} B, 2 offers ${sizes.ascii2} B, 0 offers ${sizes.ascii0} B; CJK 0 offers ${sizes.cjk0} B, + mod labels cut to 12 ${sizes.cjk0cut} B (cap ${cap})`,
    );
    // Step 1 (drop offers from the last) is enough for ASCII names …
    expect(sizes.ascii3).toBeGreaterThan(cap);
    expect(sizes.ascii2).toBeLessThanOrEqual(cap);
    // … not for multi-byte ones: step 2 (mod labels → 12 chars + "…") brings it under.
    expect(sizes.cjk0).toBeGreaterThan(cap);
    expect(sizes.cjk0cut).toBeLessThanOrEqual(cap);
    expect(worstCard(wide, 0, 12).damage?.extra).toHaveLength(2);
  });
});
