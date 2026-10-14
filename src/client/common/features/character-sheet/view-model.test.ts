// CHARX sheet view model: picker groups (FR-CHARX-29), edit rights (§10), summary card
// (FR-CHARX-32), skills / passives / overrides (FR-CHARX-05/06), pips, wallet (FR-CHARX-33).
import { describe, expect, test } from "bun:test";
import {
  type CreatureSheetRecord,
  defaultSheetData,
  SpellRow,
} from "@shared/character-sheet/sheet";
import { CharacterStatBlock } from "@shared/entities/schemas";
import {
  canEdit,
  canUseCounters,
  crLine,
  hitDicePips,
  nextProficiency,
  overrideTooltip,
  passives,
  pickerModel,
  pipDelta,
  skillRows,
  slotPips,
  spellGroups,
  summaryCard,
  walletLine,
  withSkill,
} from "./view-model";

const players = [
  { id: "p1", name: "Player 1" },
  { id: "p2", name: "Player 2" },
];
const pc = (id: string, name: string, owner: string, full = true) => ({
  id,
  kind: "character",
  name,
  ownerPlayerId: owner,
  campaignId: "c",
  ...(full ? { statBlock: {} } : {}),
});
const sheet = (p: Partial<CreatureSheetRecord>) =>
  ({ ...defaultSheetData(), ...p }) as CreatureSheetRecord;

describe("FR-CHARX-29 picker", () => {
  const ents = [
    pc("m", "Mira", "p1"),
    pc("pip", "Pip", "p1"),
    pc("t", "Thorn", "p2", false),
    pc("s", "Sela", "p2", false),
  ];
  test("FR-CHARX-29 player: own characters (marks), then Party; New hidden while a draft is open", () => {
    const sheets = { m: sheet({ locked: true }), pip: sheet({ status: "draft" }) };
    const r = pickerModel(ents, sheets, { role: "player", playerId: "p1" }, players, null);
    expect(r.options).toEqual([
      { id: "m", label: "Mira · Locked", group: "own" },
      { id: "pip", label: "Pip · Draft", group: "own" },
      { id: "s", label: "Sela (Player 2)", group: "party" },
      { id: "t", label: "Thorn (Player 2)", group: "party" },
    ]);
    expect(r.canCreate).toBe(false);
    expect(pickerModel(ents, {}, { role: "player", playerId: "p1" }, players, null).canCreate).toBe(
      true,
    );
  });

  test("FR-CHARX-29 DM: every character with owner + marks, then the NPC last opened; always New", () => {
    const all = ents.map((e) => ({ ...e, statBlock: {} }));
    const npc = { id: "e", kind: "monster", name: "Elite", ownerPlayerId: null, statBlock: {} };
    const r = pickerModel(
      all,
      { s: sheet({ status: "draft" }) },
      { role: "dm", playerId: null },
      players,
      npc,
    );
    expect(r.options.map((o) => o.label)).toEqual([
      "Mira (Player 1)",
      "Pip (Player 1)",
      "Sela (Player 2) · Draft",
      "Thorn (Player 2)",
      "Elite (NPC)",
    ]);
    expect(r.canCreate).toBe(true);
  });
});

describe("CHARX §10 edit rights", () => {
  const dm = { role: "dm" as const, playerId: null };
  const p1 = { role: "player" as const, playerId: "p1" };
  test("CHARX §10 DM any campaign creature; owner unless locked; imported never; others never", () => {
    const mira = pc("m", "Mira", "p1");
    expect(canEdit(dm, mira, { locked: true })).toBe(true);
    expect(canEdit(p1, mira, { locked: false })).toBe(true);
    expect(canEdit(p1, mira, { locked: true })).toBe(false);
    expect(canEdit(p1, pc("t", "Thorn", "p2"), undefined)).toBe(false);
    const goblin = {
      id: "g",
      kind: "monster",
      name: "Goblin",
      ownerPlayerId: null,
      campaignId: null,
      statBlock: {},
    };
    expect(canEdit(dm, goblin, undefined)).toBe(false);
    expect(canEdit(dm, { ...goblin, campaignId: "c" }, undefined)).toBe(true);
    expect(canUseCounters(p1, mira)).toBe(true);
    expect(canUseCounters(dm, { ...goblin, campaignId: "c" })).toBe(false);
  });
});

describe("FR-CHARX-32 summary card", () => {
  test("FR-CHARX-32 name, owner, level line, species; Down / death state only", () => {
    const e = {
      id: "b",
      name: "Brin",
      portraitAssetId: null,
      ownerPlayerId: "p1",
      down: false,
      level: 1,
      className: "Rogue",
      species: "Halfling",
      deathState: null,
    };
    expect(summaryCard(e, players)).toEqual({
      name: "Brin",
      owner: "Player 1",
      level: "Level 1 Rogue",
      species: "Halfling",
      status: null,
    });
    expect(summaryCard({ ...e, down: true, deathState: "dying" }, players).status).toBe("Down");
    expect(summaryCard({ ...e, down: true, deathState: "stable" }, players).status).toBe("Stable");
    expect(summaryCard({ ...e, deathState: "dead" }, players).status).toBe("Dead");
    expect(summaryCard({ ...e, species: null }, players).species).toBeNull();
  });
});

const brin = CharacterStatBlock.parse({
  size: "medium",
  ac: 14,
  hpMax: 9,
  initBonus: 3,
  attacks: [],
  abilities: { str: 8, dex: 16, con: 12, int: 10, wis: 12, cha: 10 },
  skills: { stealth: "expertise", perception: "proficient" },
  overrides: { "skill.stealth": { value: 8, note: "Test" }, "passive.perception": { value: 14 } },
  spellcasting: { ability: "wis", slots: { "1": 2, "3": 1 } },
  classes: [{ name: "Rogue", level: 1, hitDie: "d8" }],
  level: 1,
  className: "Rogue",
});

describe("FR-CHARX-05 FR-CHARX-06 derived rows", () => {
  test("FR-CHARX-05 18 skill rows: proficiency, bonus, override marker; none without scores", () => {
    const rows = skillRows(brin);
    expect(rows).toHaveLength(18);
    expect(rows?.find((r) => r.skill === "stealth")).toMatchObject({
      abbr: "DEX",
      proficiency: "expertise",
      bonus: 8,
      overridden: true,
    });
    expect(rows?.find((r) => r.skill === "perception")).toMatchObject({
      bonus: 3,
      overridden: false,
    });
    const { abilities: _a, skills: _s, spellcasting: _c, ...bare } = brin;
    expect(skillRows(bare)).toBeNull();
    expect(passives(brin).map((p) => [p.skill, p.value, p.overridden])).toEqual([
      ["perception", 14, true],
      ["investigation", 10, false],
      ["insight", 11, false],
    ]);
  });

  test("FR-CHARX-06 tooltip 'Derived +7 · Override: Test'; none when not overridden", () => {
    expect(overrideTooltip(brin, "skill.stealth")).toBe("Derived +7 · Override: Test");
    expect(overrideTooltip(brin, "passive.perception")).toBe("Derived 13 · Override 14");
    expect(overrideTooltip(brin, "skill.athletics")).toBeNull();
  });

  test("skill proficiency cycles none → proficient → expertise → none", () => {
    expect(nextProficiency(null)).toBe("proficient");
    expect(nextProficiency("proficient")).toBe("expertise");
    expect(nextProficiency("expertise")).toBeNull();
    expect(withSkill({ stealth: "expertise" }, "stealth", null)).toEqual({});
  });
});

describe("FR-CHARX-17 pips, spells, wallet", () => {
  test("slot pips per level with max > 0; hit dice; click / Shift+click", () => {
    expect(slotPips(brin, { slotsUsed: { "1": 1 } })).toEqual([
      { level: "1", max: 2, used: 1 },
      { level: "3", max: 1, used: 0 },
    ]);
    expect(hitDicePips(brin, { hitDiceUsed: {} })).toEqual([{ die: "d8", max: 1, used: 0 }]);
    expect(pipDelta(false)).toBe(1);
    expect(pipDelta(true)).toBe(-1);
  });

  test("spells grouped by level, cantrips first", () => {
    const sp = (id: string, level: number) => SpellRow.parse({ id, name: id, level });
    expect(
      spellGroups([sp("b", 1), sp("a", 0), sp("c", 1)]).map((g) => [
        g.level,
        g.spells.map((s) => s.id),
      ]),
    ).toEqual([
      [0, ["a"]],
      [1, ["b", "c"]],
    ]);
  });

  test("FR-CHARX-33 wallet line; missing = 0 gp; NPC CR line", () => {
    expect(walletLine(undefined)).toBe("0 gp");
    expect(walletLine({ cp: 0, sp: 0, ep: 0, gp: 21, pp: 0 })).toBe("21 gp");
    expect(crLine("1/2")).toBe("CR 1/2 · 100 XP");
  });
});
