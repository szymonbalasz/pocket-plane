import { describe, expect, test } from "bun:test";
import { sheetSelection } from "@ui/features/character-sheet/selection";
import { CHAR_SHEET_KIND } from "@ui/features/character-sheet/window";
import {
  hpText,
  openPartyLine,
  type PartyCharacter,
  partyLines,
  passiveTitle,
  tempText,
} from "./party-lines";

const mira: PartyCharacter = {
  id: "mira",
  kind: "character",
  name: "Mira",
  ownerPlayerId: "p1",
  hpCurrent: 12,
  tempHp: 0,
  statBlock: {
    level: 1,
    ac: 16,
    hpMax: 12,
    abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 12, cha: 10 },
    skills: { perception: "proficient", insight: "proficient" },
    overrides: { "passive.perception": { value: 14, note: "Alert (test)" } },
  },
};
const pip: PartyCharacter = {
  id: "pip",
  kind: "character",
  name: "pip",
  ownerPlayerId: "p1",
  hpCurrent: 0,
  statBlock: { level: 2, ac: 12, hpMax: 9 },
};
const sela: PartyCharacter = {
  id: "sela",
  kind: "character",
  name: "Sela",
  ownerPlayerId: "p2",
  hpCurrent: 10,
  tempHp: 5,
  statBlock: {
    level: 1,
    ac: 13,
    hpMax: 10,
    abilities: { str: 8, dex: 12, con: 12, int: 14, wis: 16, cha: 10 },
  },
};
const goblin: PartyCharacter = { id: "gob", kind: "monster", name: "Goblin", ownerPlayerId: null };

describe("FR-CAMP-21 party lines", () => {
  const lines = partyLines([sela, pip, goblin, mira], new Set(["sela"]));

  test("FR-CAMP-21 per owner, sorted by name (case-insensitive); monsters skipped; no character → none", () => {
    expect(lines.get("p1")?.map((l) => l.id)).toEqual(["mira", "pip"]);
    expect(lines.get("p2")?.map((l) => l.id)).toEqual(["sela"]);
    expect(lines.get("p3")).toBeUndefined();
    expect([...lines.keys()].sort()).toEqual(["p1", "p2"]);
  });

  test("FR-CAMP-21 Mira: Lvl, AC, HP stored; PP from the override; Inv / Ins derived", () => {
    const m = lines.get("p1")?.[0];
    expect(m).toMatchObject({ level: 1, ac: 16, hpCurrent: 12, hpMax: 12, temp: 0, draft: false });
    expect(hpText(m as never)).toBe("12 / 12");
    expect(m?.passives.map((p) => [p.short, p.value, p.overridden])).toEqual([
      ["PP", 14, true],
      ["Inv", 10, false],
      ["Ins", 13, false],
    ]);
    expect(passiveTitle(m?.passives[0] as never)).toBe("Passive Perception (override)");
    expect(passiveTitle(m?.passives[1] as never)).toBe("Passive Investigation");
  });

  test("FR-CAMP-21 Pip: no ability scores → passives —; HP 0 → Down", () => {
    const p = lines.get("p1")?.[1];
    expect(p?.passives.map((x) => x.value)).toEqual([null, null, null]);
    expect(p?.down).toBe(true);
    expect(hpText(p as never)).toBe("0 / 9");
  });

  test("FR-CAMP-21 Sela: draft marked; temp HP 5 → '+5 temp'; WIS 16 → 18 raises PP and Ins by 1", () => {
    const s = lines.get("p2")?.[0];
    expect(s?.draft).toBe(true);
    expect(tempText(s?.temp ?? 0)).toBe("+5 temp");
    expect(tempText(0)).toBeNull();
    const before = s?.passives.map((x) => x.value);
    expect(before).toEqual([13, 12, 13]);
    const wiser = {
      ...sela,
      statBlock: { ...sela.statBlock, abilities: { ...sela.statBlock?.abilities, wis: 18 } },
    } as PartyCharacter;
    const after = partyLines([wiser], new Set()).get("p2")?.[0];
    expect(after?.passives.map((x) => x.value)).toEqual([14, 12, 14]);
  });

  test("FR-CAMP-21 old data: no tempHp → 0; no level / AC / HP max → —", () => {
    const bare: PartyCharacter = { id: "x", kind: "character", name: "X", ownerPlayerId: "p1" };
    const l = partyLines([bare], new Set()).get("p1")?.[0];
    expect(l).toMatchObject({ level: null, ac: null, hpMax: null, temp: 0 });
    expect(hpText(l as never)).toBe("0 / —");
  });

  test("FR-CAMP-22 a line click opens the DM's char.sheet on it (picker choice), no intent", () => {
    sheetSelection.setState({ selectedId: "mira", npcId: null, editId: null });
    const opened: string[] = [];
    openPartyLine("sela", (k) => opened.push(k));
    expect(sheetSelection.getState().selectedId).toBe("sela");
    expect(opened).toEqual([CHAR_SHEET_KIND]);
  });
});
