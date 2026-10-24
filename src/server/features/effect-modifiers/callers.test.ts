// FR-MOD-15/16/19/20: every roll caller passes a subject; outcome totals include the parts;
// rolled = base + parts (no "DM set" on an unedited total); card, `cbt.attack` and death-save
// lines name the parts. Card size per MOD §12.
import { describe, expect, test } from "bun:test";
import type {
  AttackResult,
  CardRoll,
  DamageCardPayload,
  HpChangeRecord,
  RollDamageResult,
} from "@shared/combat-tracker/schemas";
import { partRollIdsOf } from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import type { RollEntryPayload, RollPayloadItem } from "@shared/dice-roll-log/schemas";
import { jsonBytes } from "@shared/notifications/schemas";
import { eq } from "drizzle-orm";
import { combatant, gameLogEntry, roll } from "../../db/schema";
import { DAMAGE_CARD_PAYLOAD_MAX_BYTES } from "../combat-tracker/card-kind";
import { type ModSetup, modSetup } from "./testing";

const entry = (t: ModSetup, id: string) =>
  t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get();
const items = (t: ModSetup, id: string) => entry(t, id)?.payload as RollEntryPayload;
const baseTotal = (t: ModSetup, rollId: string) =>
  t.s.db.select().from(roll).where(eq(roll.id, rollId)).get()?.total as number;
/** DM text and player text of a log entry. */
const lines = (t: ModSetup, id: string) => {
  const e = entry(t, id);
  const at = { kind: e?.kind as string, actorName: e?.actorName as string, payload: e?.payload };
  return {
    dm: lineText(formatEntry({ ...at, dmPayload: e?.dmPayload }).segments),
    player: lineText(formatEntry(at).segments),
  };
};
const partSum = (i: RollPayloadItem | CardRoll | undefined) =>
  (i?.mods ?? []).reduce((s, m) => s + m.value, 0);
const card = (t: ModSetup, cardId: string) => t.note(cardId)?.payload as DamageCardPayload;

describe("FR-MOD-15 char.roll", () => {
  test("FR-MOD-15/16 Bless on Mira: toHit, attack (to-hit part only), save get +1d4; damage none; ids in rollIds", () => {
    const t = modSetup();
    t.bless();
    const roll = (kind: string, extra: object = {}) =>
      t.run<{ rollIds: string[]; entryId: string }>(
        "char.roll",
        { characterId: t.miraId, kind, ...extra },
        t.p1,
      );
    const toHit = roll("toHit");
    const [hit] = items(t, toHit.entryId);
    expect(hit?.mods?.map((m) => m.label)).toEqual(["Bless"]);
    expect(hit?.total).toBe(baseTotal(t, hit?.rollId as string) + partSum(hit));
    expect(toHit.rollIds as unknown).toEqual([hit?.rollId, hit?.mods?.[0]?.rollId]);
    expect(lines(t, toHit.entryId).player).toMatch(
      /^Mira — Shortsword attack: \d+ \+ 4 \+ \d Bless = \d+/,
    );
    const both = roll("attack");
    const [a, d] = items(t, both.entryId);
    expect([a?.mods?.length, d?.mods] as unknown).toEqual([1, undefined]);
    expect(both.rollIds).toHaveLength(3);
    expect(items(t, roll("damage").entryId)[0]?.mods).toBeUndefined();
    expect(items(t, roll("save", { ability: "wis" }).entryId)[0]?.mods).toHaveLength(1);
    // Checks are not saves: Bless adds nothing; Guidance (check) does, also on skills.
    expect(items(t, roll("skill", { skill: "perception" }).entryId)[0]?.mods).toBeUndefined();
    t.apply({ targets: [{ characterId: t.miraId }], preset: { key: "guidance" } });
    const skill = items(t, roll("skill", { skill: "perception" }).entryId)[0];
    expect(skill?.mods?.map((m) => m.label)).toEqual(["Guidance"]);
    expect(items(t, roll("check", { ability: "str" }).entryId)[0]?.mods).toHaveLength(1);
  });

  test("FR-MOD-15 NPC-sheet definition rolls carry no subject", () => {
    const t = modSetup();
    t.apply({ targets: [{ combatantId: t.id("Goblin") }], preset: { key: "bane" } });
    const r = t.run<{ entryId: string }>("char.roll", {
      characterId: t.h.goblinId,
      kind: "save",
      ability: "dex",
    });
    expect(items(t, r.entryId)[0]?.mods).toBeUndefined();
    expect(entry(t, r.entryId)?.dmPayload).toBeNull();
  });
});

describe("FR-MOD-15/16 cbt.attack and apply", () => {
  test("FR-MOD-16 Baned Goblin: card to-hit total incl. − Bane; apply as rolled → toHitRolled incl. part, no 'DM set'; edit → 'DM set; rolled T'", () => {
    const t = modSetup();
    t.apply({ targets: [{ combatantId: t.id("Goblin") }], preset: { key: "bane" } });
    const r = t.run<AttackResult>("cbt.attack", {
      attackerId: t.id("Goblin"),
      manual: [{ diceTotal: 15 }, { diceTotal: 3 }],
    });
    const p = card(t, r.cardId);
    const bane = p.toHit?.mods?.[0];
    expect(bane?.label).toBe("Bane");
    expect(bane?.value).toBeLessThan(0);
    expect(p.toHit?.total).toBe(15 + 4 + (bane?.value ?? 0));
    expect(p.damage?.mods).toBeUndefined();
    expect(r.rollIds as unknown).toEqual([p.toHit?.rollId, bane?.rollId, p.damage?.rollId]);
    expect(t.note(r.cardId)?.text).toContain(`${p.toHit?.total} to hit`);
    const apply = (toHitTotal: number) =>
      t.run("cbt.applyCard", {
        cardId: r.cardId,
        toHitTotal,
        damageTotal: p.damage?.total,
        damageRollId: p.damage?.rollId ?? null,
        partRollIds: partRollIdsOf(p),
        targets: [{ targetId: t.id("Mira"), hit: true, multiplier: "normal" }],
        public: true,
      });
    apply(p.toHit?.total as number);
    const [row] = t.hpRows() as HpChangeRecord[];
    expect(row).toMatchObject({ toHitRolled: p.toHit?.total, toHitTotal: p.toHit?.total });
    expect(row?.rollIds).toEqual(r.rollIds);
    const out = lines(t, row?.entryId as string);
    const sign = `− ${Math.abs(bane?.value ?? 0)} Bane`;
    expect(out.player).toBe(
      `Goblin attacks Mira: 15 + 4 ${sign} (rolled for you) = ${p.toHit?.total} — DM: hit. 5 slashing damage (physical)`,
    );
    expect(out.dm).toContain(sign);
    expect(out.dm).not.toContain("DM set");
    // Undo, then the DM edits the to-hit: "DM set; rolled" names the rolled value incl. parts.
    t.undo();
    apply((p.toHit?.total as number) + 1);
    const edited = lines(t, (t.hpRows().at(-1) as HpChangeRecord).entryId);
    expect(edited.dm).toContain(`(DM set; rolled ${p.toHit?.total})`);
    expect(edited.player).not.toContain("Bane");
  });

  test("FR-MOD-16 split attack: to-hit with Bless; Bless ends; Damage gets + 2 Rage only, to-hit part kept", () => {
    const t = modSetup();
    t.bless();
    const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    t.toggle(t.thornId, rage, true, t.p2);
    const r = t.run<AttackResult>(
      "cbt.attack",
      { attackerId: t.id("Thorn"), rolls: "toHit", manual: [{ diceTotal: 12 }] },
      t.p2,
    );
    const before = card(t, r.cardId);
    expect(before.toHit?.mods?.map((m) => m.label)).toEqual(["Bless"]);
    t.end(t.active().find((e) => e.kind === "concentration")?.id as string);
    const d = t.run<RollDamageResult>(
      "cbt.rollDamage",
      { attackerId: t.id("Thorn"), manual: { diceTotal: 2 } },
      t.p2,
    );
    expect(d.attached).toBe(true);
    const after = card(t, r.cardId);
    expect(after.toHit).toEqual(before.toHit);
    expect(after.damage?.mods).toEqual([{ label: "Rage", value: 2 }]);
    expect(after.damage?.total).toBe(2 + 3 + 2);
    expect(t.note(r.cardId)?.text).toBe(`Thorn: ${after.toHit?.total} to hit, 7 piercing`);
    const damageLine = t.events.at(-1)?.event.changes.find((c) => c.type === "game-log-entry");
    expect(lines(t, damageLine?.id as string).player).toBe(
      "Thorn — Dagger damage (piercing): 2 + 3 + 2 Rage = 7 (physical)",
    );
  });

  test("FR-MOD-14/16 natural 20: bonus damage dice double on the card; flat Rage doesn't", () => {
    const t = modSetup();
    t.d6OnThorn();
    const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    t.toggle(t.thornId, rage, true, t.p2);
    const r = t.run<AttackResult>(
      "cbt.attack",
      { attackerId: t.id("Thorn"), manual: [{ diceTotal: 20 }, { diceTotal: 5 }] },
      t.p2,
    );
    const p = card(t, r.cardId);
    expect(p.crit).toBe(true);
    expect(p.damage?.mods?.map((m) => [m.label, m.expression ?? null])).toEqual([
      ["Hunter's Mark", "2d6"],
      ["Rage", null],
    ]);
    expect(p.damage?.total).toBe(5 + 3 + partSum(p.damage ?? undefined));
  });
});

describe("FR-MOD-15 Initiative row, concentration, death saves", () => {
  test("FR-MOD-15/19/23 cbt.rollAbility: Bane on Goblin's save; secret 'Cursed' reads (DM) for players", () => {
    const t = modSetup();
    t.apply({ targets: [{ combatantId: t.id("Goblin") }], preset: { key: "bane" } });
    const g = t.run<{ entryId: string }>("cbt.rollAbility", {
      combatantId: t.id("Goblin"),
      kind: "save",
      ability: "dex",
      public: true,
    });
    expect(items(t, g.entryId)[0]?.mods?.map((m) => m.label)).toEqual(["Bane"]);
    const cursed = t.put({
      characterId: null,
      name: "Cursed",
      modifiers: [{ kind: "flat", on: { roll: "save" }, value: -2 }],
      durationRounds: null,
      concentration: false,
    });
    t.apply({
      targets: [{ combatantId: t.id("Goblin 2") }],
      preset: { presetId: cursed },
      secret: true,
    });
    const r = t.run<{ entryId: string }>("cbt.rollAbility", {
      combatantId: t.id("Goblin 2"),
      kind: "save",
      ability: "wis",
      manual: { diceTotal: 11 },
      public: true,
    });
    const out = lines(t, r.entryId);
    expect(out.player).toBe("Goblin 2 — Wisdom save: 11 - 1 − 2 (DM) = 8 (physical)");
    expect(out.dm).toBe("Goblin 2 — Wisdom save: 11 - 1 − 2 Cursed = 8 (physical)");
    expect(JSON.stringify(entry(t, r.entryId)?.payload)).not.toContain("Cursed");
    // Checks are not saves.
    const c = t.run<{ entryId: string }>("cbt.rollAbility", {
      combatantId: t.id("Goblin 2"),
      kind: "check",
      ability: "wis",
    });
    expect(items(t, c.entryId)[0]?.mods).toBeUndefined();
  });

  test("FR-MOD-16 cbt.rollInitiative: the value includes the parts", () => {
    const t = modSetup({ round1: false });
    const alert = t.put({
      characterId: null,
      name: "Alert",
      modifiers: [{ kind: "flat", on: { roll: "initiative" }, value: 5 }],
      durationRounds: null,
      concentration: false,
    });
    t.apply({ targets: [{ characterId: t.miraId }], preset: { presetId: alert } });
    // Round 0: the DM may re-roll.
    const r = t.run<{ rollIds: string[] }>("cbt.rollInitiative", {
      combatantIds: [t.id("Mira")],
      manual: { diceTotal: 10 },
    });
    expect(r.rollIds).toHaveLength(1);
    const mira = t.s.db
      .select()
      .from(combatant)
      .where(eq(combatant.id, t.id("Mira")))
      .get();
    expect(mira?.initiative).toBe(10 + 2 + 5);
  });

  test("FR-MOD-16 concentration save: Bless counts vs the DC (9 + d4 ≥ 10 keeps it); a fail ends Bless on both", () => {
    const t = modSetup();
    t.bless();
    t.hp("Mira", "damage", 1);
    const save = (diceTotal: number) => {
      const cardId = t.cards().find((c) => c.state === "pending")?.id as string;
      return t.run<{ entryId: string; success: boolean }>(
        "cbtx.rollConcentration",
        { notificationId: cardId, manual: { diceTotal } },
        t.p1,
      );
    };
    // Mira's CON save +4: 5 + 4 = 9 < DC 10 alone; Bless's d4 makes it.
    const kept = save(5);
    expect(kept.success).toBe(true);
    const [item] = items(t, kept.entryId);
    expect(item?.total).toBe(9 + partSum(item));
    expect(lines(t, kept.entryId).player).toMatch(
      /: 5 \+ 4 \+ \d Bless \(rolled for you\) = \d+ — kept \(physical\)$/,
    );
    t.hp("Mira", "damage", 1);
    const lost = save(1);
    expect(lost.success).toBe(false);
    expect(t.active().filter((e) => e.label === "Bless")).toEqual([]);
    const next = t.run<{ entryId: string }>(
      "char.roll",
      { characterId: t.thornId, kind: "toHit" },
      t.p2,
    );
    expect(items(t, next.entryId)[0]?.mods).toBeUndefined();
  });

  test("FR-MOD-16/20 death save: ≥ 10 on the total incl. Bless; the outcome after the total", () => {
    const t = modSetup();
    t.bless();
    t.hp("Thorn", "damage", 10);
    const r = t.run<{ entryId: string }>(
      "cbtx.rollDeathSave",
      { characterId: t.thornId, manual: { diceTotal: 8 } },
      t.p2,
    );
    const [item] = items(t, r.entryId);
    const total = 8 + partSum(item);
    expect(item?.total).toBe(total);
    const outcome = total >= 10 ? "success" : "failure";
    expect(lines(t, r.entryId).player).toBe(
      `Thorn — Death save: 8 + ${partSum(item)} Bless (rolled for you) = ${total} — ${outcome} (physical)`,
    );
    expect(t.character(t.thornId)).toMatchObject(
      outcome === "success" ? { deathSuccesses: 1 } : { deathFailures: 1 },
    );
  });
});

describe("MOD §12 card size", () => {
  test("FR-MOD-19 50 dice + saveDc + ids + 12 parts at max label length ≤ the damage card's payloadMaxBytes", () => {
    const id = "0".repeat(36);
    const label = "\u{1F409}".repeat(40);
    const part = (i: number) => ({
      label: "Ω".repeat(40),
      value: -48,
      expression: "4d12",
      auto: true as const,
      rollId: `${i}`.padStart(36, "0"),
    });
    const roll = (n: number): CardRoll => ({
      rollId: id,
      dice: Array.from({ length: n }, () => [100, true] as [number, boolean]),
      constant: -30,
      total: -99_999,
      manual: true,
      mods: Array.from({ length: 6 }, (_, i) => part(i)),
    });
    const payload: DamageCardPayload = {
      encounterId: id,
      attackerId: id,
      attackerName: label,
      attackName: label,
      damageType: "bludgeoning",
      mode: "disadvantage",
      crit: true,
      toHit: { ...roll(2), natural: 20 },
      damage: roll(50),
      attackId: id,
      saveDc: { dc: 30, ability: "wis" },
    };
    expect(jsonBytes(payload)).toBeLessThanOrEqual(DAMAGE_CARD_PAYLOAD_MAX_BYTES);
  });
});
