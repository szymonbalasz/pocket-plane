// Sprint 5 track R core (R0): Apply hit and the hit ruling (FR-CBT-88, ruling lifecycle of
// FR-CBT-91, `damageRollId` of FR-CBT-94, FR-MOD-63's "Apply hit spends nothing"), the ally side
// (FR-CBT-98–100) and stored combat trails (FR-CBT-97, FR-MAP-65, -66). CBTX's ambush, round 1.
import { describe, expect, test } from "bun:test";
import { attackLogKind } from "@shared/combat-tracker/log-kinds";
import { sideOf } from "@shared/combat-tracker/rules";
import {
  type ApplyHitResult,
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
  DamageCardPayload,
  HIT_RULING_TYPE,
  type HitRulingRecord,
  type RollDamageResult,
} from "@shared/combat-tracker/schemas";
import { sideLogKind } from "@shared/combat-tracker/side-kind";
import { lineText } from "@shared/dice-roll-log/kind-types";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { MAP_INTENTS, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { asc, eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { gameLogEntry, hitRuling, notification, token } from "../../db/schema";
import type { Actor, RecordChange } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { cbtxSetup } from "../combat-extras/testing";
import { noteDismiss } from "../notifications/commands";
import { createScene, placeToken } from "../scenes-map/commands";
import { tokenMoveGuards } from "../scenes-map/move-guards";
import { toTokenRecord } from "../scenes-map/rows";
import { attackCommand } from "./attack";
import { rollDamageCommand } from "./damage";
import { createEncounter } from "./encounters";
import { applyHitCommand, HIT_ALREADY_APPLIED } from "./hit";
import { DAMAGE_JUST_ARRIVED } from "./hp";
import { setRemoved } from "./initiative";
import { startCommand } from "./lifecycle";
import { setSideCommand } from "./sides";
import { combatSetup } from "./testing";

type Setup = ReturnType<typeof setup>;

function setup(opts: { round1?: boolean } = {}) {
  const t = cbtxSetup(opts);
  // Players reach the battle scene's tokens (and move their own) only while it is active.
  t.run(MAP_INTENTS.activateScene, { sceneId: t.sceneId });
  const p1 = t.player(t.h.p1);
  const dmV = t.h.viewer("dm");
  const p1V = t.h.viewer("player", t.h.p1.id);
  const p2V = t.h.viewer("player", t.h.p2.id);
  const toHit = (attacker: string, d20: number, actor: Actor = p1) =>
    t.run<AttackResult>(
      attackCommand.name,
      { attackerId: t.id(attacker), rolls: "toHit", manual: [{ diceTotal: d20 }] },
      actor,
    );
  const damage = (attacker: string, dice: number, actor: Actor = p1) =>
    t.run<RollDamageResult>(
      rollDamageCommand.name,
      { attackerId: t.id(attacker), manual: { diceTotal: dice } },
      actor,
    );
  const target = (name: string, hit: boolean, multiplier = "normal") => ({
    targetId: t.id(name),
    hit,
    multiplier,
  });
  const applyHit = (cardId: string, toHitTotal: number, targets: object[], actor = t.h.dm) =>
    t.run<ApplyHitResult>(applyHitCommand.name, { cardId, toHitTotal, targets }, actor);
  const card = (cardId: string) => {
    const r = t.s.db.select().from(notification).where(eq(notification.id, cardId)).get();
    if (!r) throw new Error(`no card ${cardId}`);
    return { ...r, p: DamageCardPayload.parse(r.payload) };
  };
  const entries = () =>
    t.s.db
      .select()
      .from(gameLogEntry)
      .orderBy(asc(gameLogEntry.n))
      .all() as unknown as GameLogEntryRecord[];
  const line = (e: GameLogEntryRecord, dm: boolean) => {
    const kind = e.kind === "cbt.side" ? sideLogKind : attackLogKind;
    return lineText(
      kind.formatLine({
        actorName: e.actorName,
        payload: e.payload,
        ...(dm ? { dmPayload: e.dmPayload } : {}),
      } as Parameters<typeof kind.formatLine>[0]),
    );
  };
  const rulings = () => t.s.db.select().from(hitRuling).all();
  const snap = (v: Viewer, type: string) => (t.h.snapshot(v)[type] ?? []) as unknown[];
  const wire = (changes: readonly RecordChange[], v: Viewer) =>
    changes.map((c) => t.s.records.filterChange(c, v)).filter((w) => w !== null);
  /** A DM store kept from one snapshot by every event's DM wire changes (live = fresh). */
  const dmStore = () => {
    const store = new Map<string, unknown>(
      (snap(dmV, HIT_RULING_TYPE) as HitRulingRecord[]).map((r) => [r.id, r]),
    );
    let seen = t.events.length;
    return () => {
      for (const e of t.events.slice(seen)) {
        for (const w of wire(e.event.changes, dmV)) {
          if (w.type !== HIT_RULING_TYPE) continue;
          if (w.op === "delete") store.delete(w.id);
          else store.set(w.id, w.data);
        }
      }
      seen = t.events.length;
      return [...store.values()];
    };
  };
  const tokenRow = (id: string) =>
    toTokenRecord(t.s.db.select().from(token).where(eq(token.id, id)).get() as never);
  const move = (tokenId: string, col: number, row: number, actor: Actor = t.h.dm) =>
    t.run(MAP_INTENTS.moveToken, { tokenId, col, row }, actor);
  const combatant = (name: string) => t.byName(t.enc.id)[name] as CombatantRecord;
  const setSide = (name: string, side: string, secret?: boolean, actor = t.h.dm) =>
    t.run(
      setSideCommand.name,
      { combatantId: t.id(name), side, ...(secret === undefined ? {} : { secret }) },
      actor,
    );
  return {
    ...t,
    p1,
    dmV,
    p1V,
    p2V,
    toHit,
    damage,
    target,
    applyHit,
    card,
    entries,
    line,
    rulings,
    snap,
    wire,
    dmStore,
    tokenRow,
    move,
    combatant,
    setSide,
  };
}

const written = (t: Setup) => [
  t.count("hit_ruling"),
  t.count("game_log_entry"),
  t.count("hp_change"),
];

describe("FR-CBT-88 cbt.applyHit", () => {
  test("FR-CBT-88 applyHit writes the hit lines: ruling, one line per target, no HP, card unchanged", () => {
    const t = setup();
    const { cardId } = t.toHit("Mira", 11);
    const before = t.card(cardId);
    const hp = [t.combatant("Goblin").hpCurrent, t.combatant("Goblin 2").hpCurrent];
    const n = t.events.length;
    const { rulingId } = t.applyHit(cardId, 15, [
      t.target("Goblin", true, "half"),
      t.target("Goblin 2", false),
    ]);
    expect(t.typesSince(n)).toEqual(["HitApplied"]);
    const ev = t.events.at(-1)?.event;
    const lines = t.entries().slice(-2);
    expect(ev?.payload).toEqual({
      cardId,
      encounterId: t.enc.id,
      rulingId,
      entryIds: lines.map((e) => e.id),
    });
    expect(t.rulings()).toEqual([
      {
        id: rulingId,
        campaignId: t.h.campaignId,
        encounterId: t.enc.id,
        cardId,
        toHitTotal: 15,
        toHitSet: false,
        targets: [
          { targetId: t.id("Goblin"), hit: true, multiplier: "half" },
          { targetId: t.id("Goblin 2"), hit: false, multiplier: "normal" },
        ],
        createdAt: expect.any(String),
      },
    ]);
    // Players: "— DM: hit." ends the line (no damage yet); the DM's line keeps AC and the hint.
    expect(lines.map((e) => t.line(e, false))).toEqual([
      "Mira attacks Goblin: 11 + 4 = 15 (physical) — DM: hit.",
      "Mira attacks Goblin 2: 11 + 4 = 15 (physical) — DM: miss",
    ]);
    expect(t.line(lines[0] as GameLogEntryRecord, true)).toBe(
      "Mira attacks Goblin: 11 + 4 = 15 (physical) vs AC 15 — hit!",
    );
    expect(t.line(lines[1] as GameLogEntryRecord, true)).toBe(
      "Mira attacks Goblin 2: 11 + 4 = 15 (physical) vs AC 15 — DM ruled miss",
    );
    expect(lines.map((e) => [e.public, e.payload])).toEqual([
      [true, expect.objectContaining({ awaitingDamage: true, damage: 0, hit: true })],
      [true, expect.objectContaining({ awaitingDamage: true, hit: false })],
    ]);
    // No HP, no hp_change; the card stays pending and unchanged (no card upsert).
    expect(t.count("hp_change")).toBe(0);
    expect([t.combatant("Goblin").hpCurrent, t.combatant("Goblin 2").hpCurrent]).toEqual(hp);
    expect(t.card(cardId)).toEqual(before);
    expect(ev?.changes.some((c) => c.type === "notification")).toBe(false);
    // FR-MOD-63: Apply hit spends nothing.
    expect(t.count("trigger_use")).toBe(0);
  });

  test("FR-CBT-88 errors, one code per case; nothing written", () => {
    const t = setup();
    const { cardId } = t.toHit("Mira", 11);
    const w = written(t);
    const err = (fn: () => unknown) => t.err(fn);
    expect(err(() => t.applyHit(cardId, 15, [t.target("Goblin", false)])).code).toBe("invalid");
    expect(
      err(() =>
        t.run(applyHitCommand.name, {
          cardId,
          toHitTotal: 15,
          targets: [t.target("Goblin", true), t.target("Goblin", true)],
        }),
      ).code,
    ).toBe("invalid");
    const many = Array.from({ length: 21 }, (_, i) => ({
      ...t.target("Goblin", true),
      targetId: `x${i}`,
    }));
    expect(err(() => t.applyHit(cardId, 15, many)).code).toBe("invalid");
    expect(
      err(() => t.applyHit(cardId, 15, [{ ...t.target("Goblin", true), targetId: "nope" }])).code,
    ).toBe("not_found");
    t.run(setRemoved.name, { combatantId: t.id("Goblin 2"), removed: true });
    expect(err(() => t.applyHit(cardId, 15, [t.target("Goblin 2", true)])).code).toBe("not_found");
    expect(err(() => t.applyHit(cardId, 15, [t.target("Goblin", true)], t.p1)).code).toBe(
      "forbidden",
    );
    // A damage-only card has no to-hit roll.
    const dmg = t.damage("Thorn", 3, t.player(t.h.p2));
    expect(err(() => t.applyHit(dmg.cardId, 15, [t.target("Goblin", true)])).code).toBe("invalid");
    expect(written(t).slice(0, 1)).toEqual(w.slice(0, 1));
    // Ruled once → conflict; resolved → conflict.
    t.applyHit(cardId, 15, [t.target("Goblin", true)]);
    const again = err(() => t.applyHit(cardId, 15, [t.target("Goblin", true)]));
    expect([again.code, again.message]).toEqual(["conflict", HIT_ALREADY_APPLIED]);
    const other = t.toHit("Mira", 12);
    t.run(noteDismiss.name, { id: other.cardId });
    expect(err(() => t.applyHit(other.cardId, 16, [t.target("Goblin", true)])).code).toBe(
      "conflict",
    );
  });

  test("FR-CBT-88 a hidden target's line is DM-only; the DM's total over the roll is toHitSet", () => {
    const t = setup();
    const { cardId } = t.toHit("Mira", 11);
    t.applyHit(cardId, 17, [t.target("Wolf", true), t.target("Goblin", true)]);
    const [wolf, gob] = t.entries().slice(-2) as [GameLogEntryRecord, GameLogEntryRecord];
    expect([wolf.public, gob.public]).toEqual([false, true]);
    expect(t.rulings()[0]?.toHitSet).toBe(true);
    expect(t.line(gob, false)).toBe("Mira attacks Goblin: 17 — DM: hit.");
    expect(t.line(gob, true)).toBe("Mira attacks Goblin: 17 (DM set; rolled 15) vs AC 15 — hit!");
  });

  test("FR-CBT-88 hit-ruling is DM-only: snapshot, live change", () => {
    const t = setup();
    const { cardId } = t.toHit("Mira", 11);
    t.applyHit(cardId, 15, [t.target("Goblin", true)]);
    expect(t.snap(t.dmV, HIT_RULING_TYPE)).toHaveLength(1);
    for (const v of [t.p1V, t.p2V]) {
      expect(t.snap(v, HIT_RULING_TYPE)).toEqual([]);
      const frames = t.wire(t.events.at(-1)?.event.changes ?? [], v);
      expect(frames.some((w) => w.type === HIT_RULING_TYPE)).toBe(false);
      expect(JSON.stringify(frames)).not.toContain("rulingId");
    }
  });
});

describe("FR-CBT-91 ruling lifecycle (R0) and FR-CBT-94 damageRollId", () => {
  test("FR-CBT-91 Apply sends the ruling's delete, Undo its upsert, End its delete; DM store = a fresh snapshot", () => {
    const t = setup();
    const store = t.dmStore();
    const { cardId } = t.toHit("Mira", 11);
    t.applyHit(cardId, 15, [t.target("Goblin", true)]);
    const fresh = () => t.snap(t.dmV, HIT_RULING_TYPE);
    expect(store()).toEqual(fresh());
    expect(fresh()).toHaveLength(1);
    // The late roll attaches (ADR-0037 rule unchanged); the ruling stays.
    const d = t.damage("Mira", 4);
    expect(d).toMatchObject({ cardId, attached: true });
    expect(store()).toEqual(fresh());
    const c = t.card(cardId).p;
    t.run("cbt.applyCard", {
      cardId,
      toHitTotal: 15,
      damageTotal: c.damage?.total,
      damageRollId: c.damage?.rollId,
      targets: [t.target("Goblin", true)],
    });
    expect(fresh()).toEqual([]);
    expect(store()).toEqual([]);
    expect(t.rulings()).toHaveLength(1);
    t.undo();
    expect(fresh()).toHaveLength(1);
    expect(store()).toEqual(fresh());
    t.endEncounter();
    expect(store()).toEqual([]);
    expect(t.rulings()).toHaveLength(1);
  });

  test("FR-CBT-94 a stale damageRollId → conflict, nothing written; the right one applies", () => {
    const t = setup();
    const { cardId } = t.toHit("Mira", 11);
    // Roll → Apply hit is valid too (either order).
    t.damage("Mira", 4);
    t.applyHit(cardId, 15, [t.target("Goblin", true)]);
    const c = t.card(cardId).p;
    const input = {
      cardId,
      toHitTotal: 15,
      damageTotal: c.damage?.total,
      targets: [t.target("Goblin", true)],
    };
    const w = written(t);
    const e = t.err(() => t.run("cbt.applyCard", { ...input, damageRollId: null }));
    expect([e.code, e.message]).toEqual(["conflict", DAMAGE_JUST_ARRIVED]);
    expect(written(t)).toEqual(w);
    expect(t.card(cardId).state).toBe("pending");
    t.run("cbt.applyCard", { ...input, damageRollId: c.damage?.rollId });
    expect(t.card(cardId).state).toBe("resolved");
  });

  test("FR-CBT-91 crash: Apply hit commits ruling + lines together or not at all", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = setup();
    const { cardId } = t.toHit("Mira", 11);
    const w = written(t);
    try {
      armCrashHook({ point: "before-commit", target: applyHitCommand.name }, kill);
      expect(() => t.applyHit(cardId, 15, [t.target("Goblin", true)])).toThrow();
      expect(written(t)).toEqual(w);
      armCrashHook({ point: "after-commit", target: applyHitCommand.name }, kill);
      expect(() => t.applyHit(cardId, 15, [t.target("Goblin", true)])).toThrow(Killed);
      const [rulings = 0, lines = 0, hp = 0] = w;
      expect(written(t)).toEqual([rulings + 1, lines + 1, hp]);
    } finally {
      armCrashHook(null);
    }
  });
});

describe("FR-CBT-98–100 ally side (R0 server)", () => {
  test("FR-CBT-98 side defaults and Start copy: null = kind's default; a friendly entry starts ally", () => {
    const t = combatSetup();
    const enc = t.run<{ id: string }>(createEncounter.name, {
      name: "Escort to the Ford",
      partyCharacterIds: null,
      entries: [
        { definitionId: t.h.goblinId, quantity: 2 },
        { definitionId: t.h.goblinId, quantity: 1, side: "ally" },
      ],
      addHidden: false,
    });
    // A friendly and an enemy entry of one definition stay apart.
    const sides = t.s.db.$client
      .query<{ side: string; quantity: number }, []>(
        "SELECT side, quantity FROM encounter_entry ORDER BY seq",
      )
      .all();
    expect(sides).toEqual([
      { side: "enemy", quantity: 2 },
      { side: "ally", quantity: 1 },
    ]);
    t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
    const rows = t.combatants(enc.id);
    expect(rows.map((c) => [c.kind, c.side, c.publicSide, sideOf(c)])).toEqual([
      ["pc", null, null, "ally"],
      ["pc", null, null, "ally"],
      ["monster", null, null, "enemy"],
      ["monster", null, null, "enemy"],
      ["monster", "ally", "ally", "ally"],
    ]);
    const p = t.h.snapshot(t.h.viewer("player", t.h.p1.id))[COMBATANT_TYPE] as {
      side: string;
    }[];
    expect(p.map((c) => c.side)).toEqual(["ally", "ally", "enemy", "enemy", "ally"]);
  });

  test("FR-CBT-99 setSide: open / secret, PCs both ways, no-op, reveal, errors, not undoable", () => {
    const t = setup();
    let n = t.events.length;
    t.setSide("Goblin 2", "ally");
    expect(t.typesSince(n)).toEqual(["CombatantSideChanged"]);
    expect(t.events.at(-1)?.event.payload).toEqual({
      encounterId: t.enc.id,
      combatantId: t.id("Goblin 2"),
      side: "ally",
      secret: false,
    });
    expect(t.combatant("Goblin 2")).toMatchObject({ side: "ally", publicSide: "ally" });
    let e = t.entries().at(-1) as GameLogEntryRecord;
    expect([e.kind, e.public, t.line(e, true), t.line(e, false)]).toEqual([
      "cbt.side",
      true,
      "DM — Goblin 2 is now an ally",
      "Goblin 2 is now an ally",
    ]);
    // Repeat → no-op: no event, no line.
    n = t.events.length;
    const lines = t.count("game_log_entry");
    t.setSide("Goblin 2", "ally");
    expect(t.events.length).toBe(n);
    expect(t.count("game_log_entry")).toBe(lines);
    // A PC set to enemy in secret: players keep ally; a DM-only line.
    t.setSide("Mira", "enemy", true);
    expect(t.combatant("Mira")).toMatchObject({ side: "enemy", publicSide: null });
    e = t.entries().at(-1) as GameLogEntryRecord;
    expect([e.public, t.line(e, true), t.line(e, false)]).toEqual([
      false,
      "DM — Mira is now an enemy (secret)",
      "Mira is now an enemy",
    ]);
    // An open set to the side players don't see yet is a reveal: written, public line.
    t.setSide("Mira", "enemy");
    expect(t.combatant("Mira")).toMatchObject({ side: "enemy", publicSide: "enemy" });
    expect((t.entries().at(-1) as GameLogEntryRecord).public).toBe(true);
    // A hidden combatant's line is DM-only; a removed one may change.
    t.setSide("Wolf", "ally");
    expect((t.entries().at(-1) as GameLogEntryRecord).public).toBe(false);
    t.run(setRemoved.name, { combatantId: t.id("Goblin"), removed: true });
    t.setSide("Goblin", "ally");
    expect(t.combatant("Goblin").side).toBe("ally");
    // Errors.
    expect(t.err(() => t.setSide("Goblin 2", "enemy", false, t.p1)).code).toBe("forbidden");
    expect(
      t.err(() => t.run(setSideCommand.name, { combatantId: "nope", side: "ally" })).code,
    ).toBe("not_found");
    // Not undoable: Undo has nothing (no HP change happened).
    expect(t.err(() => t.undo()).code).toBe("conflict");
    t.endEncounter();
    expect(t.err(() => t.setSide("Goblin 2", "enemy")).code).toBe("conflict");
    // A combatant of an ended encounter, with another one running → not_found.
    const next = t.run<{ id: string }>(createEncounter.name, {
      name: "Second",
      partyCharacterIds: [],
      entries: [{ definitionId: t.h.goblinId, quantity: 1 }],
    });
    t.run(startCommand.name, { encounterId: next.id, sceneId: t.sceneId });
    expect(t.err(() => t.setSide("Goblin 2", "enemy")).code).toBe("not_found");
  });

  test("FR-CBT-100 side for players: publicSideOf only; open ally → secret enemy → no player change", () => {
    const t = setup();
    const pSide = (v: Viewer, name: string) =>
      (t.snap(v, COMBATANT_TYPE) as { name: string; side: string }[]).find((c) => c.name === name)
        ?.side;
    t.setSide("Goblin 2", "ally", true);
    expect(pSide(t.p1V, "Goblin 2")).toBe("enemy");
    t.setSide("Mira", "enemy", true);
    expect(pSide(t.p2V, "Mira")).toBe("ally");
    t.setSide("Goblin 2", "ally");
    expect(pSide(t.p1V, "Goblin 2")).toBe("ally");
    // The betrayal: nothing new for players (no upsert, no line).
    t.setSide("Goblin 2", "enemy", true);
    const ev = t.events.at(-1)?.event;
    for (const v of [t.p1V, t.p2V]) {
      expect(t.wire(ev?.changes ?? [], v)).toEqual([]);
      expect(pSide(v, "Goblin 2")).toBe("ally");
      const raw = JSON.stringify(t.h.snapshot(v));
      expect(raw).not.toContain("publicSide");
    }
    expect(pSide(t.dmV, "Goblin 2")).toBe("enemy");
    // A hidden ally never reaches players.
    t.setSide("Wolf", "ally");
    expect(pSide(t.p1V, "Wolf")).toBeUndefined();
  });
});

describe("FR-CBT-97 / FR-MAP-65 / FR-MAP-66 stored trails", () => {
  test("FR-CBT-97 trail writes: moves append, the move's one upsert carries it; 21 cells kept", () => {
    const t = setup();
    const gob = t.tokens.goblin;
    t.move(gob, 13, 6);
    const ev = t.events.at(-1)?.event;
    const upserts = (ev?.changes ?? []).filter((c) => c.type === TOKEN_TYPE && c.id === gob);
    expect(upserts).toHaveLength(1);
    expect((upserts[0]?.after as TokenRecord | undefined)?.trail).toEqual({
      cells: [
        [12, 6],
        [13, 6],
      ],
    });
    t.move(gob, 13, 7);
    expect(t.tokenRow(gob).trail).toEqual({
      cells: [
        [12, 6],
        [13, 6],
        [13, 7],
      ],
    });
    for (let i = 0; i < 25; i++) t.move(gob, 13 + (i % 2), 8);
    const cells = t.tokenRow(gob).trail?.cells ?? [];
    expect(cells).toHaveLength(21);
    expect(cells.at(-1)).toEqual([13, 8]);
  });

  test("FR-CBT-97 Next, Prev, End clear; Start round 1 clears", () => {
    const t = setup();
    t.move(t.tokens.goblin, 13, 6);
    t.move(t.tokens.mira, 3, 7, t.p1);
    t.step("next");
    const ev = t.events.find((e) => e.event.type === "TurnChanged" && e === t.events.at(-1));
    const cleared = (ev?.event.changes ?? []).filter((c) => c.type === TOKEN_TYPE);
    expect(cleared.map((c) => (c.after as TokenRecord).trail)).toEqual([null, null]);
    expect([t.tokenRow(t.tokens.goblin).trail, t.tokenRow(t.tokens.mira).trail]).toEqual([
      null,
      null,
    ]);
    t.move(t.tokens.goblin, 14, 6);
    t.step("prev");
    expect(t.tokenRow(t.tokens.goblin).trail).toBeNull();
    t.move(t.tokens.goblin, 13, 6);
    t.endEncounter();
    expect(t.tokenRow(t.tokens.goblin).trail).toBeNull();
    const r0 = setup({ round1: false });
    r0.move(r0.tokens.goblin, 13, 6);
    expect(r0.tokenRow(r0.tokens.goblin).trail).not.toBeNull();
    r0.step("next");
    expect(r0.tokenRow(r0.tokens.goblin).trail).toBeNull();
  });

  test("FR-CBT-97 no segment: a refused move, another scene, outside combat", () => {
    const t = setup();
    tokenMoveGuards.register("test.refuse-trail", () => ({ refuse: "No" }));
    try {
      expect(t.err(() => t.move(t.tokens.goblin, 13, 6)).code).toBe("conflict");
    } finally {
      tokenMoveGuards.unregister("test.refuse-trail");
    }
    expect(t.tokenRow(t.tokens.goblin).trail).toBeNull();
    const other = t.run<{ id: string }>(createScene.name, { name: "Town", mapAssetId: "map-town" });
    const tid = t.run<{ tokenId: string }>(placeToken.name, {
      sceneId: other.id,
      definitionId: t.h.goblinId,
      col: 2,
      row: 2,
    }).tokenId;
    t.move(tid, 3, 2);
    expect(t.tokenRow(tid).trail).toBeNull();
    const out = combatSetup();
    out.run(MAP_INTENTS.moveToken, { tokenId: out.tokens.goblin, col: 13, row: 6 });
    const row = out.s.db.select().from(token).where(eq(token.id, out.tokens.goblin)).get();
    expect(row?.trail).toBeNull();
  });

  test("FR-CBT-97 FR-MAP-66 moves while hidden append nothing; the reveal resets the trail", () => {
    const t = setup();
    const gob = t.tokens.goblin;
    t.move(gob, 13, 6);
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: gob, hidden: true });
    t.move(gob, 14, 6);
    t.move(gob, 15, 6);
    expect(t.tokenRow(gob).trail).toEqual({
      cells: [
        [12, 6],
        [13, 6],
      ],
    });
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: gob, hidden: false });
    const ev = t.events.at(-1)?.event;
    const up = (ev?.changes ?? []).filter((c) => c.type === TOKEN_TYPE && c.id === gob);
    expect(up.map((c) => (c.after as TokenRecord).trail)).toEqual([null]);
    expect(t.tokenRow(gob).trail).toBeNull();
    // The next move starts from the current cell.
    t.move(gob, 15, 7);
    expect(t.tokenRow(gob).trail).toEqual({
      cells: [
        [15, 6],
        [15, 7],
      ],
    });
    // The Wolf (hidden all along) never gets one.
    t.move(t.tokens.wolf, 14, 5);
    expect(t.tokenRow(t.tokens.wolf).trail).toBeNull();
  });

  test("FR-MAP-66 trail visibility: DM every token's, players only player tokens'", () => {
    const t = setup();
    t.move(t.tokens.goblin, 13, 6);
    t.move(t.tokens.mira, 3, 7, t.p1);
    t.move(t.tokens.thorn, 3, 9, t.player(t.h.p2));
    const trailOf = (v: Viewer, id: string) =>
      (t.snap(v, TOKEN_TYPE) as Record<string, unknown>[]).find((x) => x.id === id);
    expect(trailOf(t.dmV, t.tokens.goblin)?.trail).toEqual({
      cells: [
        [12, 6],
        [13, 6],
      ],
    });
    for (const v of [t.p1V, t.p2V]) {
      // Party knowledge: every player gets each player token's whole trail.
      expect(trailOf(v, t.tokens.mira)?.trail).toEqual({
        cells: [
          [2, 7],
          [3, 7],
        ],
      });
      expect(trailOf(v, t.tokens.thorn)?.trail).toEqual({
        cells: [
          [2, 9],
          [3, 9],
        ],
      });
      expect(Object.keys(trailOf(v, t.tokens.goblin) ?? {})).not.toContain("trail");
      // The Goblin's move: the player upsert carries no trail.
      const moved = t.events.filter((e) => e.event.type === "TokenMoved")[0]?.event;
      const w = t.wire(moved?.changes ?? [], v).find((x) => x.id === t.tokens.goblin);
      expect(JSON.stringify(w)).not.toContain("trail");
    }
  });
});
