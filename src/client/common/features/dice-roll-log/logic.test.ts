import { describe, expect, test } from "bun:test";
import {
  actorOptions,
  createFlagStore,
  createStickToBottom,
  type FlagBackend,
  manualNatural,
  manualSlots,
  modeFromKeys,
  optionsDirty,
  optionsKey,
  parseManual,
  physicalKey,
  publicState,
  slotsAfterFirst,
  sortEntries,
} from "./logic";

describe("FR-DICE-05 keys → mode", () => {
  test("FR-DICE-05 Shift = advantage, Ctrl = disadvantage, both = normal; keys override the toggle", () => {
    expect(modeFromKeys({ shiftKey: true }, "normal")).toBe("advantage");
    expect(modeFromKeys({ ctrlKey: true }, "advantage")).toBe("disadvantage");
    expect(modeFromKeys({ shiftKey: true, ctrlKey: true }, "advantage")).toBe("normal");
    expect(modeFromKeys({}, "disadvantage")).toBe("disadvantage");
    expect(modeFromKeys(undefined, "advantage")).toBe("advantage");
  });
});

describe("FR-DICE-07 physical-dice mode", () => {
  test("FR-DICE-07 storage key per campaign and client", () => {
    expect(physicalKey("c1", "dm", null)).toBe("pp.dice.v1.c1.dm");
    expect(physicalKey("c1", "player", "p9")).toBe("pp.dice.v1.c1.p9");
  });
});

function memoryBackend() {
  const data = new Map<string, string>();
  const backend: FlagBackend = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
  return { data, backend };
}

describe("FR-DICE-30 compact roll bar", () => {
  test("FR-DICE-30 options key per campaign and client, beside the FR-DICE-07 entry", () => {
    expect(optionsKey("c1", "dm", null)).toBe("pp.dice.options.v1.c1.dm");
    expect(optionsKey("c1", "player", "p9")).toBe("pp.dice.options.v1.c1.p9");
    expect(optionsKey("c2", "player", "p9")).not.toBe(optionsKey("c1", "player", "p9"));
  });

  test("FR-DICE-30 options state round-trips per (campaign, owner); no entry → closed", () => {
    const { data, backend } = memoryBackend();
    const store = createFlagStore(() => backend);
    const dm = optionsKey("c1", "dm", null);
    const p1 = optionsKey("c1", "player", "p1");
    const other = optionsKey("c2", "dm", null);
    expect(store.read(dm)).toBe(false);
    store.write(dm, true);
    expect(data.get(dm)).toBe("1");
    expect(store.read(dm)).toBe(true);
    expect(store.read(p1)).toBe(false);
    expect(store.read(other)).toBe(false);
    // Read back by a fresh store (a reload) from the same storage.
    expect(createFlagStore(() => backend).read(dm)).toBe(true);
    store.write(dm, false);
    expect(data.get(dm)).toBe("0");
    expect(createFlagStore(() => backend).read(dm)).toBe(false);
  });

  test("FR-DICE-30 throwing storage → closed by default, toggles kept in memory", () => {
    const throwing: FlagBackend = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const store = createFlagStore(() => throwing);
    const key = optionsKey("c1", "dm", null);
    expect(store.read(key)).toBe(false);
    store.write(key, true);
    expect(store.read(key)).toBe(true);
    const none = createFlagStore(() => undefined);
    expect(none.read(key)).toBe(false);
    none.write(key, true);
    expect(none.read(key)).toBe(true);
    const getterThrows = createFlagStore(() => {
      throw new Error("blocked");
    });
    expect(getterThrows.read(key)).toBe(false);
  });

  test("FR-DICE-30 hidden-option dot: category, actor, label, DM public ≠ preset", () => {
    const base = {
      category: "other",
      actor: "",
      label: "",
      isDm: true,
      publicValue: false,
      publicPreset: false,
    } as const;
    expect(optionsDirty(base)).toBe(false);
    expect(optionsDirty({ ...base, category: "skill-check" })).toBe(true);
    expect(optionsDirty({ ...base, actor: "entity:e1" })).toBe(true);
    expect(optionsDirty({ ...base, label: "Stealth" })).toBe(true);
    expect(optionsDirty({ ...base, label: "   " })).toBe(false);
    expect(optionsDirty({ ...base, publicValue: true })).toBe(true);
    expect(optionsDirty({ ...base, publicValue: true, publicPreset: true })).toBe(false);
    // Players have no public toggle.
    expect(optionsDirty({ ...base, isDm: false, publicValue: true })).toBe(false);
  });

  test("FR-DICE-30 DM eye toggle preset from the category; an override sticks to its category", () => {
    expect(publicState(true, "damage", null)).toEqual({ value: true, overridden: false });
    expect(publicState(false, "skill-check", null)).toEqual({ value: false, overridden: false });
    const hid = { category: "damage", value: false } as const;
    expect(publicState(true, "damage", hid)).toEqual({ value: false, overridden: true });
    // Changing category drops the override: the eye shows the new category's preset.
    expect(publicState(false, "skill-check", hid)).toEqual({ value: false, overridden: false });
    expect(publicState(true, "attack", hid)).toEqual({ value: true, overridden: false });
  });
});

describe("FR-DICE-24 roll control", () => {
  test("FR-DICE-24 one manual slot per expression; adv/dis only where there is a d20", () => {
    expect(manualSlots(["1d20+4", "1d6+2"], "advantage")).toEqual([
      { expression: "2d20kh1+4", faces: [20, 20] },
      { expression: "1d6+2", faces: [6] },
    ]);
    expect(manualSlots(["2d6"], "advantage")).toBe("Advantage needs a d20 roll");
    expect(manualSlots(["1000d1000"], "normal")).toBe("At most 50 dice");
  });

  test("FR-DICE-24 crit swap: a natural 20 on the first shows critExpressions for the rest", () => {
    const exprs = ["1d20+4", "1d6+2"];
    const crit = ["2d6+2"];
    expect(slotsAfterFirst(exprs, crit, { diceTotal: 20 }, "1d20+4")).toEqual(["2d6+2"]);
    expect(slotsAfterFirst(exprs, crit, { diceTotal: 19 }, "1d20+4")).toEqual(["1d6+2"]);
    expect(slotsAfterFirst(exprs, undefined, { diceTotal: 20 }, "1d20+4")).toEqual(["1d6+2"]);
    expect(slotsAfterFirst(exprs, crit, null, "1d20+4")).toEqual(["1d6+2"]);
    // Advantage: total-only of the kept die, or per-die values.
    expect(slotsAfterFirst(exprs, crit, { diceTotal: 20 }, "2d20kh1+4")).toEqual(["2d6+2"]);
    expect(slotsAfterFirst(exprs, crit, { diceTotal: 20, dice: [20, 3] }, "2d20kh1+4")).toEqual([
      "2d6+2",
    ]);
    expect(manualNatural("2d20kl1", { diceTotal: 3, dice: [20, 3] })).toBe(3);
    expect(manualNatural("1d20+1d4", { diceTotal: 21 })).toBeNull();
  });

  test("FR-DICE-06 manual form: total, optional per-die values, kept total computed", () => {
    const adv = { expression: "2d20kh1+4", faces: [20, 20] };
    expect(parseManual(adv, "17", ["", ""])).toEqual({ diceTotal: 17 });
    expect(parseManual(adv, "", ["5", "17"])).toEqual({ diceTotal: 17, dice: [5, 17] });
    expect(parseManual(adv, "17", ["5", ""])).toBe("Enter all 2 dice or none");
    expect(parseManual(adv, "", ["21", "1"])).toBe("Die 1 must be 1–20");
    expect(parseManual(adv, "", ["", ""])).toBe("Enter the dice total");
    expect(parseManual(adv, "x", [])).toBe("Dice total must be a whole number");
  });
});

describe("FR-DICE-27 actor select", () => {
  const ents = [
    { id: "m", kind: "character" as const, name: "Mira", ownerPlayerId: "p1" },
    { id: "t", kind: "character" as const, name: "Thorn", ownerPlayerId: "p2" },
    { id: "g", kind: "monster" as const, name: "Elite", ownerPlayerId: null },
  ];
  test("FR-DICE-27 player: me + own characters; DM: DM + every character", () => {
    expect(actorOptions({ role: "player", playerId: "p1" }, ents)).toEqual([
      { value: "", label: "Me" },
      { value: "m", label: "Mira", group: "Characters", ref: { entityId: "m" } },
    ]);
    expect(actorOptions({ role: "dm", playerId: null }, ents).map((a) => a.label)).toEqual([
      "DM",
      "Mira",
      "Thorn",
    ]);
  });

  test("FR-DICE-27 DM also gets the active scene's tokens (placement order); players never", () => {
    const scenes = [
      { id: "s1", active: false },
      { id: "s2", active: true },
    ];
    const tokens = [
      { id: "t3", sceneId: "s2", name: "Goblin 2", seq: 3 },
      { id: "t1", sceneId: "s1", name: "Wolf", seq: 1 },
      { id: "t2", sceneId: "s2", name: "Goblin", seq: 2 },
    ];
    const dm = actorOptions({ role: "dm", playerId: null }, ents, scenes, tokens);
    expect(dm.filter((a) => a.group === "Tokens")).toEqual([
      { value: "t2", label: "Goblin", group: "Tokens", ref: { tokenId: "t2" } },
      { value: "t3", label: "Goblin 2", group: "Tokens", ref: { tokenId: "t3" } },
    ]);
    expect(actorOptions({ role: "dm", playerId: null }, ents, [], tokens)).toHaveLength(3);
    const p = actorOptions({ role: "player", playerId: "p1" }, ents, scenes, tokens);
    expect(p.some((a) => a.group === "Tokens")).toBe(false);
  });

  test("FR-DICE-27 a character's token on the active scene is not listed twice", () => {
    const scenes = [{ id: "s1", active: true }];
    const tokens = [
      { id: "tm", sceneId: "s1", name: "Mira", seq: 1, definitionId: "m" },
      { id: "tg", sceneId: "s1", name: "Goblin", seq: 2, definitionId: "g" },
    ];
    const dm = actorOptions({ role: "dm", playerId: null }, ents, scenes, tokens);
    expect(dm.map((a) => a.label)).toEqual(["DM", "Mira", "Thorn", "Goblin"]);
    expect(dm.find((a) => a.label === "Mira")?.ref).toEqual({ entityId: "m" });
  });
});

describe("FR-DICE-21 log order", () => {
  test("FR-DICE-21 oldest at the top by n", () => {
    expect(sortEntries([{ n: 3 }, { n: 1 }, { n: 2 }]).map((e) => e.n)).toEqual([1, 2, 3]);
  });
});

describe("FR-DICE-21 stick to the bottom", () => {
  const m = (scrollTop: number, clientHeight: number, scrollHeight = 300) => ({
    scrollTop,
    clientHeight,
    scrollHeight,
  });

  test("FR-DICE-21 footer grows (Options row / Physical strip): a pinned list stays at the bottom", () => {
    const s = createStickToBottom();
    expect(s.resized(m(160, 140))).toBe(300); // first observation, pinned
    // The bar grows by 34 px: the old scrollTop leaves the newest entry cut off. A scroll
    // event fired before the resize is seen must not unpin it.
    expect(s.scrolled(m(160, 106))).toBe(true);
    expect(s.resized(m(160, 106))).toBe(300);
    expect(s.scrolled(m(194, 106))).toBe(true);
    // And back: shrinking the bar keeps it pinned too.
    expect(s.resized(m(194, 140))).toBe(300);
    expect(s.atBottom).toBe(true);
  });

  test("FR-DICE-21 scrolled up: a resize leaves the position alone; back at the bottom re-pins", () => {
    const s = createStickToBottom();
    s.resized(m(160, 140));
    expect(s.scrolled(m(40, 140))).toBe(false);
    expect(s.resized(m(40, 106))).toBeNull();
    expect(s.atBottom).toBe(false);
    expect(s.scrolled(m(190, 106))).toBe(true); // within the slack of the bottom
    s.scrolled(m(0, 106));
    s.pin(); // "N new" clicked
    expect(s.atBottom).toBe(true);
  });
});
