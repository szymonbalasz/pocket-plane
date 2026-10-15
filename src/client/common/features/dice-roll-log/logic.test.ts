import { describe, expect, test } from "bun:test";
import type { RollMode } from "@shared/dice-roll-log/schemas";
import {
  actorOptions,
  checkGroup,
  computedTotal,
  createFlagStore,
  createStickToBottom,
  critExtra,
  diceRange,
  type FlagBackend,
  type FormOptions,
  type FormSlot,
  formEntries,
  formSlots,
  type GroupInput,
  manualNatural,
  manualSlots,
  mergeCrit,
  modeFromKeys,
  optionsDirty,
  optionsKey,
  physicalKey,
  publicState,
  type SlotInput,
  sortEntries,
  updateInputs,
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

  test("FR-DICE-24 crit: a natural 20 on the first (total or kept die) adds the crit group", () => {
    const o = { expressions: ["1d20+4", "1d6+2"], critExpressions: ["2d6+2"] };
    const first = (total: string, dice: string[] = [], expr = "1d20+4") => [
      { for: expr, base: g(total, dice), extra: g() },
    ];
    const d6 = { expression: "1d6", faces: [6] };
    expect(slotsOf(o, first("20"))[1]?.extra).toEqual(d6);
    expect(slotsOf(o, first("19"))[1]?.extra).toBeNull();
    expect(slotsOf(o, [])[1]?.extra).toBeNull();
    expect(slotsOf({ expressions: o.expressions }, first("20"))[1]?.extra).toBeNull();
    // Advantage: total-only of the kept die, or per-die values.
    expect(slotsOf(o, first("20", ["", ""], "2d20kh1+4"), "advantage")[1]?.extra).toEqual(d6);
    expect(slotsOf(o, first("", ["3", "20"], "2d20kh1+4"), "advantage")[1]?.extra).toEqual(d6);
    expect(manualNatural("2d20kl1", { diceTotal: 3, dice: [20, 3] })).toBe(3);
    expect(manualNatural("1d20+1d4", { diceTotal: 21 })).toBeNull();
  });

  test("FR-DICE-24 crit swap fallback: a crit rule that isn't doubled dice shows the crit expression", () => {
    const o = { expressions: ["1d20+4", "2d6kh1+2"], critExpressions: ["4d6kh1+2"] };
    const nat20 = [{ for: "1d20+4", base: g("20"), extra: g() }];
    expect(slotsOf(o, nat20)).toEqual([
      { base: { expression: "1d20+4", faces: [20] }, extra: null },
      { base: { expression: "4d6kh1+2", faces: [6, 6, 6, 6] }, extra: null },
    ]);
  });

  test("FR-DICE-06 manual group: total, optional per-die values, kept total computed", () => {
    const adv = { expression: "2d20kh1+4", faces: [20, 20] };
    const name = adv.expression;
    expect(checkGroup(adv, g("17", ["", ""]), name)).toEqual({ entry: { diceTotal: 17 } });
    expect(checkGroup(adv, g("", ["5", "17"]), name)).toEqual({
      entry: { diceTotal: 17, dice: [5, 17] },
    });
    expect(checkGroup(adv, g("17", ["5", ""]), name)).toEqual({
      message: "Enter all 2 dice or none",
      die: 1,
    });
    expect(checkGroup(adv, g("", ["21", "1"]), name)).toEqual({
      message: "Die 1 must be 1–20",
      die: 0,
    });
    expect(checkGroup(adv, g("x"), name)).toEqual({
      message: "Dice total must be a whole number",
      die: null,
    });
    expect(checkGroup(adv, g("12", ["5", "17"]), name)).toEqual({
      message: "The dice add up to 17, not 12",
      die: null,
    });
    expect(computedTotal(adv, g("", ["5", "17"]))).toBe(17);
    expect(computedTotal(adv, g("", ["5", ""]))).toBeNull();
    expect(diceRange("2d20kh1+4")).toEqual({ min: 1, max: 20 });
    expect(diceRange("2d6-1d4+3")).toEqual({ min: -2, max: 11 });
  });
});

/** A group input. */
function g(total = "", dice: string[] = []): GroupInput {
  return { total, dice };
}

function slotsOf(o: FormOptions, inputs: SlotInput[], mode: RollMode = "normal"): FormSlot[] {
  const s = formSlots(o, mode, inputs);
  if (typeof s === "string") throw new Error(s);
  return s;
}

const typer =
  (o: FormOptions) =>
  (inputs: SlotInput[], slot: number, group: "base" | "extra", p: Partial<GroupInput>) =>
    updateInputs(o, "normal", inputs, { slot, group }, p);

describe("FR-DICE-31 physical crit keeps what was typed", () => {
  const o = { expressions: ["1d20+5", "4d6+3"], critExpressions: ["8d6+3"] };
  const type = typer(o);

  test("FR-DICE-31 crit keeps entries", () => {
    // 4d6 per-die 3, 4, 5, 6 typed first, then the d20 = 20.
    let inputs = type([], 1, "base", { dice: ["3", "4", "5", "6"] });
    expect(slotsOf(o, inputs)[1]?.extra).toBeNull();
    inputs = type(inputs, 0, "base", { total: "20" });
    expect(slotsOf(o, inputs)[1]).toEqual({
      base: { expression: "4d6+3", faces: [6, 6, 6, 6] },
      extra: { expression: "4d6", faces: [6, 6, 6, 6] },
    });
    expect(inputs[1]?.base.dice).toEqual(["3", "4", "5", "6"]);
    expect(inputs[1]?.extra).toEqual(g("", ["", "", "", ""]));
    // Extra total 10 → one ManualEntry for 8d6: 18 + 10, no dice (the extra dice weren't entered).
    inputs = type(inputs, 1, "extra", { total: "10" });
    expect(formEntries(slotsOf(o, inputs), inputs)).toEqual({
      ok: true,
      entries: [{ diceTotal: 20 }, { diceTotal: 28 }],
    });
    // Every die entered → dice = base dice then extra dice.
    const all = type(inputs, 1, "extra", { total: "", dice: ["1", "2", "3", "4"] });
    expect(formEntries(slotsOf(o, all), all)).toEqual({
      ok: true,
      entries: [{ diceTotal: 20 }, { diceTotal: 28, dice: [3, 4, 5, 6, 1, 2, 3, 4] }],
    });
    // d20 back to 15 → extra group gone (its values dropped), base kept.
    inputs = type(all, 0, "base", { total: "15" });
    expect(slotsOf(o, inputs)[1]?.extra).toBeNull();
    expect(inputs[1]?.base.dice).toEqual(["3", "4", "5", "6"]);
    expect(inputs[1]?.extra).toEqual(g());
    expect(formEntries(slotsOf(o, inputs), inputs)).toEqual({
      ok: true,
      entries: [{ diceTotal: 15 }, { diceTotal: 18, dice: [3, 4, 5, 6] }],
    });
    // Back on 20: the extra group returns empty.
    inputs = type(inputs, 0, "base", { total: "20" });
    expect(inputs[1]?.extra).toEqual(g("", ["", "", "", ""]));
  });

  test("FR-DICE-31 single dice: the totals are the dice; multi-term dice merge per term", () => {
    const one = { expressions: ["1d20+5", "1d8+2"], critExpressions: ["2d8+2"] };
    const t = typer(one);
    let inputs = t([], 1, "base", { total: "6" });
    inputs = t(inputs, 0, "base", { total: "20" });
    expect(slotsOf(one, inputs)[1]?.extra).toEqual({ expression: "1d8", faces: [8] });
    expect(inputs[1]?.base.total).toBe("6");
    inputs = t(inputs, 1, "extra", { total: "4" });
    expect(formEntries(slotsOf(one, inputs), inputs)).toEqual({
      ok: true,
      entries: [{ diceTotal: 20 }, { diceTotal: 10, dice: [6, 4] }],
    });
    expect(critExtra("1d8+1d6+2", "2d8+2d6+2")).toEqual({ expression: "1d8+1d6", faces: [8, 6] });
    expect(
      mergeCrit(
        { expression: "1d8+1d6+2", faces: [8, 6] },
        { diceTotal: 9, dice: [7, 2] },
        { expression: "1d8+1d6", faces: [8, 6] },
        { diceTotal: 4, dice: [1, 3] },
      ),
    ).toEqual({ diceTotal: 13, dice: [7, 1, 2, 3] });
    expect(critExtra("1d6+2", "1d6+4")).toBeNull();
    expect(critExtra("2d6kh1", "4d6kh1")).toBeNull();
  });

  test("FR-DICE-31 crit: true on a Damage-only control: extra group at once, no d20 slot", () => {
    const dmg = { expressions: ["1d8+2"], critExpressions: ["2d8+2"], crit: true };
    expect(slotsOf(dmg, [])).toEqual([
      { base: { expression: "1d8+2", faces: [8] }, extra: { expression: "1d8", faces: [8] } },
    ]);
    const t = typer(dmg);
    let inputs = t([], 0, "base", { total: "6" });
    inputs = t(inputs, 0, "extra", { total: "3" });
    expect(formEntries(slotsOf(dmg, inputs), inputs)).toEqual({
      ok: true,
      entries: [{ diceTotal: 9, dice: [6, 3] }],
    });
  });
});

describe("FR-DICE-32 no silent roll", () => {
  const o = { expressions: ["1d20+5", "4d6+3"], critExpressions: ["8d6+3"] };
  const type = typer(o);

  test("FR-DICE-32 no silent roll", () => {
    let inputs = type([], 0, "base", { total: "20" });
    inputs = type(inputs, 1, "base", { total: "14" });
    // Empty extra total → nothing sent, focus on it, a message naming the group.
    expect(formEntries(slotsOf(o, inputs), inputs)).toEqual({
      ok: false,
      message: "Enter the total for 4d6 (critical)",
      focus: { slot: 1, group: "extra", die: null },
    });
    inputs = type(inputs, 1, "extra", { total: "30" });
    expect(formEntries(slotsOf(o, inputs), inputs)).toEqual({
      ok: false,
      message: "Total must be 4–24",
      focus: { slot: 1, group: "extra", die: null },
    });
    inputs = type(inputs, 1, "extra", { total: "12" });
    expect(formEntries(slotsOf(o, inputs), inputs)).toEqual({
      ok: true,
      entries: [{ diceTotal: 20 }, { diceTotal: 26 }],
    });
  });

  test("FR-DICE-32 empty boxes: the first incomplete group or die gets focus", () => {
    expect(formEntries(slotsOf(o, []), [])).toEqual({
      ok: false,
      message: "Enter the total for 1d20+5",
      focus: { slot: 0, group: "base", die: null },
    });
    let inputs = type([], 0, "base", { total: "12" });
    inputs = type(inputs, 1, "base", { dice: ["2", "", "4", ""] });
    expect(formEntries(slotsOf(o, inputs), inputs)).toEqual({
      ok: false,
      message: "Enter all 4 dice or none",
      focus: { slot: 1, group: "base", die: 1 },
    });
    inputs = type(inputs, 1, "base", { total: "25", dice: ["", "", "", ""] });
    expect(formEntries(slotsOf(o, inputs), inputs)).toMatchObject({
      ok: false,
      message: "Total must be 4–24",
    });
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

describe("FR-DICE-34 roll as token-less combatants", () => {
  const ents = [{ id: "g", kind: "monster" as const, name: "Goblin", ownerPlayerId: null }];
  const scenes = [{ id: "s1", active: true }];
  const tokens = [{ id: "t1", sceneId: "s1", name: "Goblin", seq: 1, definitionId: "g" }];
  const c = (id: string, name: string, more: Record<string, unknown> = {}) => ({
    id,
    encounterId: "e1",
    name,
    tokenId: null as string | null,
    active: true,
    removed: false,
    ...more,
  });
  const dm = { role: "dm" as const, playerId: null };

  test("FR-DICE-34 actor list", () => {
    const encounters = [
      { id: "e0", status: "ended" as const },
      { id: "e1", status: "started" as const },
    ];
    const combatants = [
      c("c1", "Goblin", { tokenId: "t1" }),
      c("c10", "Goblin 10"),
      c("c3", "Goblin 3"),
      c("c4", "Goblin 4", { removed: true }),
      c("c5", "Wolf", { active: false }),
      c("c6", "Old", { encounterId: "e0" }),
    ];
    const list = actorOptions(dm, ents, scenes, tokens, encounters, combatants);
    // After the scene's tokens; tokened combatants aren't listed again; by name.
    expect(list.map((a) => [a.group ?? "", a.label])).toEqual([
      ["", "DM"],
      ["Tokens", "Goblin"],
      ["Combatants", "Goblin 3"],
      ["Combatants", "Goblin 10"],
    ]);
    expect(list.at(2)).toEqual({
      value: "c3",
      label: "Goblin 3",
      group: "Combatants",
      ref: { combatantId: "c3" },
    });
    // Encounter ended (or none started) → gone; players never get them.
    const ended = [{ id: "e1", status: "ended" as const }];
    const none = actorOptions(dm, ents, scenes, tokens, ended, combatants);
    expect(none.some((a) => a.group === "Combatants")).toBe(false);
    const p = actorOptions(
      { role: "player", playerId: "p1" },
      ents,
      scenes,
      tokens,
      encounters,
      combatants,
    );
    expect(p.some((a) => a.group === "Combatants")).toBe(false);
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
