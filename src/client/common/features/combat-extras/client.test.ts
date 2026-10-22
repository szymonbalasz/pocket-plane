// CBTX client logic shared by both clients: token overlay `cbtx` × DM / owner / other player
// (FR-CBTX-28/29/30), chips (FR-CBTX-33/34), card outcome text (FR-CBTX-37), turn alert detail
// (FR-CBTX-38).
import { describe, expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { turnAlertFor } from "../combat-tracker/turn-alert";
import type { TokenOverlayView } from "../scenes-map/token-overlays";
import { concentrationOutcome } from "./concentration";
import {
  CHIP_MAX_W,
  CHIP_TIERS,
  chipLabel,
  chipOrder,
  chipParts,
  chipText,
  concentrationSaveText,
  deadPc,
  deathStateFor,
  endsHint,
  fitChips,
  fitChipTiers,
  MORE_W,
  splitNumbered,
} from "./logic";
import { deathSavesAvailable } from "./sheet-sections";
import { cbtxTokenOverlay } from "./token-overlay";

const dmYou: You = { campaignId: "c", role: "dm", playerId: null };
const p1You: You = { campaignId: "c", role: "player", playerId: "p1" };
const p2You: You = { campaignId: "c", role: "player", playerId: "p2" };
const byId = (rows: object[]) => Object.fromEntries(rows.map((r) => [(r as { id: string }).id, r]));

function store(you: You, o: { combatants: object[]; entities?: object[]; effects?: object[] }) {
  const s: RecordStore = {
    ...emptyStore(),
    you,
    records: {
      encounter: {
        e1: { id: "e1", status: "started", round: 2, playerTurnCombatantId: "k-mira" },
      },
      combatant: byId(o.combatants),
      entity: byId(o.entities ?? []),
      effect: byId(o.effects ?? []),
    },
  };
  return s;
}

const base = { encounterId: "e1", active: true, removed: false, movedFt: 0 };
const goblinDm = {
  ...base,
  id: "k-gob",
  kind: "monster",
  tokenId: "t-gob",
  name: "Goblin",
  hpCurrent: 3,
  hpMax: 7,
  tempHp: 2,
};
const goblinPlayer = {
  ...base,
  id: "k-gob",
  kind: "monster",
  tokenId: "t-gob",
  name: "Goblin",
  band: "bloodied",
};
const miraC = {
  ...base,
  id: "k-mira",
  kind: "pc",
  entityId: "mira",
  tokenId: "t-mira",
  name: "Mira",
};
const miraFull = {
  id: "mira",
  kind: "character",
  name: "Mira",
  ownerPlayerId: "p1",
  hpCurrent: 12,
  tempHp: 4,
  deathSuccesses: 0,
  deathFailures: 0,
  statBlock: { hpMax: 12 },
};
const miraRedacted = {
  id: "mira",
  kind: "character",
  name: "Mira",
  ownerPlayerId: "p1",
  down: false,
  deathState: null,
};
const fx = (id: string, o: object) => ({
  id,
  kind: "condition",
  condition: null,
  level: null,
  label: null,
  targetCombatantId: null,
  targetCharacterId: null,
  encounterId: "e1",
  endsRound: null,
  ...o,
});
const prone = fx("f1", { condition: "prone", targetCombatantId: "k-gob" });
const t = (id: string) => ({ id }) as TokenView;
const view = (client: "dm" | "player"): TokenOverlayView => ({
  client,
  selected: false,
  targeting: false,
});

describe("FR-CBTX-28 FR-CBTX-29 FR-CBTX-30 token overlay cbtx", () => {
  test("FR-CBTX-28 DM: proportional bars with temp, band tone; none at 0 HP", () => {
    const s = store(dmYou, { combatants: [goblinDm, miraC], entities: [miraFull] });
    expect(cbtxTokenOverlay.decorate?.(t("t-gob"), s, view("dm"))?.bar).toEqual({
      id: "cbtx-token-bar",
      fraction: 3 / 7,
      temp: 2 / 7,
      tone: "bloodied",
    });
    expect(cbtxTokenOverlay.decorate?.(t("t-mira"), s, view("dm"))?.bar).toEqual({
      id: "cbtx-token-bar",
      fraction: 1,
      temp: 4 / 12,
      tone: "full",
    });
    const down = store(dmYou, { combatants: [{ ...goblinDm, hpCurrent: 0 }] });
    expect(cbtxTokenOverlay.decorate?.(t("t-gob"), down, view("dm"))?.bar).toBeUndefined();
  });

  test("FR-CBTX-28 player: own PC proportional; other PC none; monster band tone full width", () => {
    const own = store(p1You, { combatants: [goblinPlayer, miraC], entities: [miraFull] });
    expect(cbtxTokenOverlay.decorate?.(t("t-mira"), own, view("player"))?.bar?.fraction).toBe(1);
    expect(cbtxTokenOverlay.decorate?.(t("t-gob"), own, view("player"))?.bar).toEqual({
      id: "cbtx-token-bar",
      fraction: null,
      tone: "bloodied",
    });
    const other = store(p2You, { combatants: [goblinPlayer, miraC], entities: [miraRedacted] });
    expect(cbtxTokenOverlay.decorate?.(t("t-mira"), other, view("player"))).toBeNull();
  });

  test("FR-CBTX-29 icons: one per effect held (renderer caps at 4 + '+N'); secret only for the DM", () => {
    const effects = [
      prone,
      fx("f2", { condition: "frightened", targetCombatantId: "k-gob" }),
      fx("f3", {
        kind: "custom",
        label: "Hex",
        targetCombatantId: "k-gob",
        secret: true,
        endsRound: 5,
      }),
      fx("f4", { condition: "poisoned", targetCombatantId: "k-gob" }),
      fx("f5", { condition: "blinded", targetCombatantId: "k-gob" }),
      fx("f6", { kind: "concentration", label: "Bless", targetCharacterId: "mira" }),
    ];
    const s = store(dmYou, { combatants: [goblinDm, miraC], entities: [miraFull], effects });
    const icons = cbtxTokenOverlay.decorate?.(t("t-gob"), s, view("dm"))?.icons ?? [];
    expect(icons.map((i) => [i.value, i.label])).toEqual([
      ["prone", "Prone"],
      ["frightened", "Frightened"],
      ["poisoned", "Poisoned"],
      ["blinded", "Blinded"],
      ["custom", "Hex 3r"],
    ]);
    expect(icons.every((i) => i.id === "cbtx-token-effect")).toBe(true);
    expect(cbtxTokenOverlay.decorate?.(t("t-mira"), s, view("dm"))?.icons?.[0]).toMatchObject({
      value: "concentration",
      icon: "brain",
    });
    // Players never hold secret / hidden / ended rows (server filter): only what they received.
    const p = store(p1You, { combatants: [goblinPlayer], effects: [prone] });
    expect(cbtxTokenOverlay.decorate?.(t("t-gob"), p, view("player"))?.icons).toHaveLength(1);
  });

  test("FR-CBTX-30 death badge: Dying / Stable / Dead from counters or the redacted deathState", () => {
    const at = (o: object, you = dmYou) =>
      cbtxTokenOverlay.decorate?.(
        t("t-mira"),
        store(you, { combatants: [miraC], entities: [{ ...miraFull, ...o }] }),
        view("dm"),
      )?.badges?.[0];
    expect(at({ hpCurrent: 0 })).toMatchObject({
      id: "cbtx-token-death",
      label: "Dying",
      tone: "down",
    });
    expect(at({ hpCurrent: 0, deathSuccesses: 3 })).toMatchObject({
      label: "Stable",
      tone: "neutral",
    });
    expect(at({ hpCurrent: 0, deathFailures: 3 })).toMatchObject({ label: "Dead", tone: "down" });
    expect(at({})).toBeUndefined();
    const other = store(p2You, {
      combatants: [miraC],
      entities: [{ ...miraRedacted, deathState: "stable" }],
    });
    expect(
      cbtxTokenOverlay.decorate?.(t("t-mira"), other, view("player"))?.badges?.[0]?.label,
    ).toBe("Stable");
  });

  test("FR-CBTX-50 death outside combat: unbound PC token dead → X + Dead; dying / stable at 0 HP → X + badge; healed → none; DM / owner full, other player redacted; bound → FR-CBTX-30 path only", () => {
    const tok = { id: "t-mira", characterId: "mira" } as TokenView;
    const ended = { ...miraC, active: false };
    const at = (you: typeof dmYou, entity: object) =>
      cbtxTokenOverlay.decorate?.(
        tok,
        store(you, { combatants: [ended], entities: [entity] }),
        view(you.role === "dm" ? "dm" : "player"),
      );
    const dead = at(dmYou, { ...miraFull, hpCurrent: 0, deathFailures: 3 });
    expect(dead?.cross).toEqual({ id: "cbt-token-down", tone: "down" });
    expect(dead?.badges).toEqual([
      { id: "cbtx-token-death", icon: "skull", tone: "down", label: "Dead" },
    ]);
    // Dead stays dead even after HP comes back (until the DM resets the counters).
    expect(at(dmYou, { ...miraFull, hpCurrent: 5, deathFailures: 3 })?.badges?.[0]?.label).toBe(
      "Dead",
    );
    expect(at(p1You, { ...miraFull, hpCurrent: 0 })?.badges?.[0]?.label).toBe("Dying");
    expect(at(p1You, { ...miraFull, hpCurrent: 0, deathSuccesses: 3 })).toMatchObject({
      cross: { id: "cbt-token-down" },
      badges: [{ label: "Stable", tone: "neutral" }],
    });
    expect(at(dmYou, miraFull)).toBeNull();
    // Another player: the redacted deathState.
    expect(
      at(p2You, { ...miraRedacted, down: true, deathState: "stable" })?.badges?.[0]?.label,
    ).toBe("Stable");
    expect(at(p2You, miraRedacted)).toBeNull();
    // DM: `definitionId` also links (no `characterId` copy).
    const dmTok = { id: "t-mira", characterId: null, definitionId: "mira" } as TokenView;
    expect(
      cbtxTokenOverlay.decorate?.(
        dmTok,
        store(dmYou, { combatants: [ended], entities: [{ ...miraFull, deathFailures: 3 }] }),
        view("dm"),
      )?.badges?.[0]?.label,
    ).toBe("Dead");
    // Bound: the FR-CBTX-30 badge only (the cross is combat-tracker's), no double badge.
    const bound = cbtxTokenOverlay.decorate?.(
      tok,
      store(dmYou, { combatants: [miraC], entities: [{ ...miraFull, hpCurrent: 0 }] }),
      view("dm"),
    );
    expect(bound?.badges).toHaveLength(1);
    expect(bound?.cross).toBeUndefined();
  });

  test("no bound combatant (after End) → nothing", () => {
    const s = store(dmYou, { combatants: [{ ...goblinDm, active: false }] });
    expect(cbtxTokenOverlay.decorate?.(t("t-gob"), s, view("dm"))).toBeNull();
  });
});

describe("FR-CBTX-33 FR-CBTX-34 chips, death state", () => {
  test("FR-CBTX-33 chip order (concentration, conditions, custom) and text with rounds left", () => {
    const list = [
      fx("a", { kind: "custom", label: "Bless", endsRound: 11 }),
      fx("b", { condition: "exhaustion", level: 2 }),
      fx("c", { kind: "concentration", label: "Bless", endsRound: 11 }),
    ] as Parameters<typeof chipOrder>[0];
    expect(chipOrder(list).map((e) => chipText(e, 2))).toEqual([
      "Concentrating: Bless 9r",
      "Exhaustion 2",
      "Bless 9r",
    ]);
  });

  test("FR-CBTX-46 chip fit: compact labels incl. 'Exh 2'; given widths: all fit → no +N, one too many → +1", () => {
    const list = [
      fx("c", { kind: "concentration", label: "Bless", endsRound: 11 }),
      fx("b", { condition: "exhaustion", level: 2 }),
      fx("p", { condition: "prone" }),
      fx("a", { kind: "custom", label: "Bless", endsRound: 11 }),
    ] as Parameters<typeof chipOrder>[0];
    expect(chipOrder(list).map((e) => chipLabel(e, 2))).toEqual([
      "Bless",
      "Exh 2",
      "Prone",
      "Bless 9r",
    ]);
    // Full text stays the Tooltip's.
    expect(chipText(list[0] as (typeof list)[0], 2)).toBe("Concentrating: Bless 9r");
    // Room = the name line left after the full name; gap 2 between chips.
    expect(fitChips([40, 50], 92)).toBe(2);
    expect(fitChips([40, 50], 200)).toBe(2);
    expect(fitChips([40, 50, 40], 92)).toBe(1); // 40 + 2 + "+N" fits, 92 does not
    expect(fitChips([40, 50, 40], 40 + 2 + 50 + 2 + MORE_W)).toBe(2);
    expect(fitChips([CHIP_MAX_W], 20)).toBe(0);
    expect(fitChips([], 0)).toBe(0);
  });

  test("FR-CBTX-46 BL-08 narrow rows abbreviate before '+N': labels cut at 72 px keep '3r', then '3' at 60 px", () => {
    const bless = fx("a", { kind: "custom", label: "Bless", endsRound: 12 });
    expect(chipParts(bless as Parameters<typeof chipParts>[0], 2)).toEqual({
      label: "Bless",
      rounds: 10,
    });
    expect(
      chipParts(fx("p", { condition: "prone" }) as Parameters<typeof chipParts>[0], 2),
    ).toEqual({
      label: "Prone",
      rounds: null,
    });
    expect(CHIP_TIERS.map((t) => [t.cap, t.unit])).toEqual([
      [CHIP_MAX_W, true],
      [72, true],
      [60, false],
    ]);
    // Wide enough: tier 0, nothing cut.
    expect(
      fitChipTiers(
        [
          { full: 64, short: 56 },
          { full: 62, short: 54 },
        ],
        200,
      ),
    ).toEqual({ n: 2, tier: 0 });
    // Long labels cut at 72 px (rounds kept) → both fit: 72 + 2 + 72 = 146.
    expect(
      fitChipTiers(
        [
          { full: 90, short: 82 },
          { full: 80, short: 72 },
        ],
        146,
      ),
    ).toEqual({ n: 2, tier: 1 });
    // Session-sim-6 #8, Thorn at a narrow width: "Bless 10r" + "Rage 10r" (128) don't fit 118;
    // without the unit (56 + 2 + 54 = 112) both show instead of "Bless 10r +1".
    const thorn = [
      { full: 64, short: 56 },
      { full: 62, short: 54 },
    ];
    expect(fitChips([64, 62], 118)).toBe(1);
    expect(fitChipTiers(thorn, 118)).toEqual({ n: 2, tier: 2 });
    // Untimed chips: tier 2 only caps them at 60.
    expect(
      fitChipTiers(
        [
          { full: 70, short: 70 },
          { full: 70, short: 70 },
        ],
        122,
      ),
    ).toEqual({ n: 2, tier: 2 });
    // Still too narrow: the first tier with the most whole chips, then "+N".
    expect(fitChipTiers(thorn, 60 + 2 + MORE_W)).toEqual({ n: 1, tier: 2 });
    expect(fitChipTiers(thorn, 64 + 2 + MORE_W)).toEqual({ n: 1, tier: 0 });
    expect(fitChipTiers(thorn, 20)).toEqual({ n: 0, tier: 0 });
    expect(fitChipTiers([], 0)).toEqual({ n: 0, tier: 0 });
  });

  test("FR-CBTX-25 dead PC (client copy) and death state from either shape", () => {
    expect(deathStateFor({ ...miraFull, hpCurrent: 0, deathFailures: 3 })).toBe("dead");
    expect(deathStateFor({ ...miraRedacted, deathState: "dying" })).toBe("dying");
    // ADR-0063: the redacted row holds HP but no counters → its `deathState`, not a recompute.
    const redHp = { ...miraRedacted, hpCurrent: 0, hpMax: 12, tempHp: 0, ac: 16 };
    expect(deathStateFor({ ...redHp, deathState: "stable" })).toBe("stable");
    expect(deathStateFor({ ...redHp, deathState: "dead" })).toBe("dead");
    const s = store(dmYou, { combatants: [miraC], entities: [{ ...miraFull, deathFailures: 3 }] });
    expect(deadPc(s, { kind: "pc", entityId: "mira" })).toBe(true);
  });
});

describe("FR-CBTX-37 FR-CBTX-38", () => {
  test("FR-CBTX-37 outcome text: kept / lost / Ended / Undone; pending → none", () => {
    const n = (state: string, resolution: unknown) =>
      concentrationOutcome({ state, resolution } as Parameters<typeof concentrationOutcome>[0]);
    expect(n("pending", null)).toBeNull();
    expect(n("resolved", { total: 14, dc: 12, success: true })).toBe("DC 12: 14 — kept");
    expect(n("resolved", { total: 7, dc: 12, success: false })).toBe("DC 12: 7 — lost");
    expect(n("resolved", { outcome: "ended" })).toBe("Ended");
    expect(n("resolved", { outcome: "undone" })).toBe("Undone");
  });

  test("FR-CBTX-38 turn alert detail for a dying own PC: 'Mira (death save)'", () => {
    const frame = {
      cause: { name: "TurnChanged" },
      changes: [
        {
          type: "encounter",
          id: "e1",
          op: "upsert" as const,
          data: { playerTurnCombatantId: "k-mira" },
        },
      ],
    };
    const alive = store(p1You, { combatants: [miraC], entities: [miraFull] });
    expect(turnAlertFor(frame, alive)?.detail).toBe("Mira");
    const dying = store(p1You, { combatants: [miraC], entities: [{ ...miraFull, hpCurrent: 0 }] });
    expect(turnAlertFor(frame, dying)?.detail).toBe("Mira (death save)");
  });
});

describe("FR-CBTX-41 sheet sections", () => {
  test("FR-CBTX-41 cbtx.death-saves available iff deathState != null (owner counters or redacted)", () => {
    const at = (e: object) =>
      deathSavesAvailable(store(p1You, { combatants: [], entities: [e] }), "mira");
    expect(at(miraFull)).toBe(false);
    expect(at({ ...miraFull, hpCurrent: 0 })).toBe(true);
    expect(at({ ...miraRedacted, deathState: "stable" })).toBe(true);
  });
});

describe("FR-CBTX-33 row names (walkthrough ruling)", () => {
  test("FR-CBTX-33 names split for middle truncation: the number is kept", () => {
    expect(splitNumbered("Goblin 2")).toEqual({ base: "Goblin", suffix: " 2" });
    expect(splitNumbered("Elite Goblin Warrior")).toEqual({
      base: "Elite Goblin Warrior",
      suffix: "",
    });
    expect(splitNumbered("Wolf 12")).toEqual({ base: "Wolf", suffix: " 12" });
  });
});

describe("P3 glitch 9 copy", () => {
  test("FR-CBTX-36 FR-MOD-09 ends hint: source, else the turn combatant, else the one target, else each target", () => {
    const o = { sourceName: null, turnName: null, targetNames: ["Mira", "Thorn"], endsRound: 11 };
    expect(endsHint({ ...o, sourceName: "Mira" })).toBe(
      "Ends at the start of Mira's turn, round 11",
    );
    expect(endsHint({ ...o, turnName: "Goblin" })).toBe(
      "Ends at the start of Goblin's turn, round 11",
    );
    expect(endsHint({ ...o, targetNames: ["Thorn"] })).toBe(
      "Ends at the start of Thorn's turn, round 11",
    );
    expect(endsHint(o)).toBe("Ends at the start of each target's turn, round 11");
  });

  test("FR-CBTX-42 concentration dialog formula names the effect dice a Con save picks up", () => {
    const fx = (id: string, label: string, modifiers: object[], o: object = {}) =>
      ({
        id,
        kind: "custom",
        label,
        targetCharacterId: "mira",
        targetCombatantId: null,
        endedAt: null,
        modifiers,
        ...o,
      }) as never;
    const bless = fx("e1", "Bless", [
      { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 },
      { kind: "dice", on: { roll: "save" }, dice: "1d4", sign: 1 },
    ]);
    const bane = fx("e2", "Bane", [{ kind: "dice", on: { roll: "save" }, dice: "1d4", sign: -1 }]);
    const dexOnly = fx("e3", "Haste", [
      { kind: "flat", on: { roll: "save", abilities: ["dex"] }, value: 2 },
    ]);
    const other = fx("e4", "Ward", [{ kind: "flat", on: { roll: "save" }, value: 1 }], {
      targetCharacterId: "thorn",
    });
    const mira = { characterId: "mira" };
    expect(concentrationSaveText(4, [bless], mira, 10)).toBe("d20 + 4 + 1d4 Bless vs DC 10");
    expect(concentrationSaveText(4, [bless, bane, dexOnly, other], mira, 12)).toBe(
      "d20 + 4 + 1d4 Bless − 1d4 Bane vs DC 12",
    );
    expect(concentrationSaveText(-1, [], mira, null)).toBe("d20 − 1 vs DC ?");
  });
});
