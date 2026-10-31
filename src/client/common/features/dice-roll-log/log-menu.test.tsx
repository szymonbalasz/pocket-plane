// FR-DICE-103–110 (client): the row menu's items per role and line state, the tray fill, the
// creature lookup, the request a menu item leaves for the row's Button; the details window's
// views, held state and empty state, over a fake sync store (static render).
import { afterEach, describe, expect, test } from "bun:test";
import { baseExpression } from "@shared/dice-roll-log/grammar";
import {
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryView,
  REVEAL_GUARDED,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { SparklesIcon } from "lucide-react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { IntentRejected } from "../../sync/connection";
import { SyncContext, type SyncState } from "../../sync/store";
import { landing } from "../dice-extras/landing";
import { openRollDetails, rollDetails } from "./details";
import { detailSections, entryPhysical, lineWithoutActor } from "./details-model";
import { entryMenuItems, sendEntryHidden, trayRequestOf } from "./entry-menu";
import { GameLog } from "./GameLog";
import { actorCreature } from "./logic";
import { RollDetails } from "./RollDetails";

const item = (p: Partial<RollPayloadItem> = {}): RollPayloadItem => ({
  rollId: "r1",
  expression: "2d20kh1+5",
  mode: "advantage",
  manual: false,
  dice: [
    { faces: 20, value: 13, kept: true },
    { faces: 20, value: 4, kept: false },
  ],
  constant: 5,
  total: 18,
  natural: 13,
  label: "Athletics",
  ...p,
});

const entry = (o: Partial<GameLogEntryView> = {}): GameLogEntryView => ({
  id: "e1",
  campaignId: "c1",
  n: 1,
  at: "2026-10-31T10:00:00.000Z",
  kind: "roll",
  category: "skill-check",
  public: true,
  undone: false,
  rollerRole: "player",
  rollerPlayerId: "p1",
  actorName: "Mira",
  payload: [item()],
  rollIds: ["r1"],
  encounterId: null,
  supersededBy: null,
  ...o,
});

const attack = (o: Partial<GameLogEntryView> = {}, payload: Record<string, unknown> = {}) =>
  entry({
    kind: "cbt.attack",
    category: "attack",
    payload: {
      targetName: "Goblin",
      attackName: "Longbow",
      damageType: "piercing",
      toHit: { dice: 12, constant: 4, total: 16, natural: 12 },
      hit: true,
      damage: 7,
      multiplier: "normal",
      crit: false,
      ...payload,
    },
    rollIds: [],
    ...o,
  });

const values = (o: Partial<Parameters<typeof entryMenuItems>[0]> & { entry: GameLogEntryView }) =>
  entryMenuItems({ isDm: false, live: true, landed: true, actions: [], creature: null, ...o }).map(
    (i) => i.value,
  );

afterEach(() => {
  landing.api.setState({ holding: new Map() });
  rollDetails.setState({ entryId: null, seq: 0 });
});

describe("FR-DICE-103 menu items", () => {
  test("FR-DICE-103 per role: details and copies for both; hide and the sheet for the DM only", () => {
    const creature = { id: "mira", kind: "character" as const };
    expect(values({ entry: entry() })).toEqual(["details", "tray", "copy"]);
    expect(values({ entry: entry(), isDm: true, creature })).toEqual([
      "details",
      "tray",
      "copy",
      "hide",
      "sheet",
    ]);
    // A player is never offered them, whatever the inputs say.
    expect(values({ entry: entry(), creature })).not.toContain("sheet");
  });

  test("FR-DICE-103 Hide when a player can see the line today, Reveal when none can", () => {
    const hideOf = (o: Partial<GameLogEntryView>) =>
      entryMenuItems({
        entry: entry(o),
        isDm: true,
        live: true,
        landed: true,
        actions: [],
        creature: null,
      }).find((i) => i.group === 1)?.label;
    expect(hideOf({ public: true })).toBe("Hide from players");
    expect(hideOf({ public: false, audiencePlayerId: "p1" })).toBe("Hide from players");
    expect(hideOf({ public: false, audiencePlayerId: null })).toBe("Reveal to players");
  });

  test("FR-DICE-103 FR-DICE-104 not live: what sends and the tray are disabled, what copies or shows is not", () => {
    const action = { id: "gem.reroll", label: "Inspiration: reroll", Icon: SparklesIcon };
    const items = entryMenuItems({
      entry: entry({ supersededBy: "e2" }),
      isDm: true,
      live: false,
      landed: true,
      actions: [action],
      creature: { id: "mira", kind: "character" },
    });
    expect(items.filter((i) => i.disabled).map((i) => i.value)).toEqual([
      "tray",
      "hide",
      "gem.reroll",
    ]);
    expect(items.map((i) => i.group)).toEqual([0, 0, 0, 1, 2, 2, 2]);
  });

  test("FR-DICE-103 line state: rerolled → Show new roll; undone or hidden lines still open with what applies; held → no copies; other kinds no tray", () => {
    expect(values({ entry: entry({ supersededBy: "e2" }) })).toContain("new-roll");
    expect(values({ entry: entry({ supersededBy: "e2", undone: true }) })).toEqual([
      "details",
      "tray",
      "copy",
    ]);
    expect(values({ entry: entry({ public: false }), isDm: true })).toContain("reveal");
    expect(values({ entry: entry(), landed: false })).toEqual(["details"]);
    expect(values({ entry: attack() })).toEqual(["details", "copy"]);
    expect(values({ entry: entry({ payload: [item(), item({ rollId: "r2" })] }) })).toEqual([
      "details",
      "copy",
    ]);
  });

  const creatures = () => ({
    entities: [
      { id: "mira", kind: "character", name: "Mira" },
      { id: "orc", kind: "monster", name: "Orc" },
    ] as Parameters<typeof actorCreature>[1]["entities"],
    combatants: [
      { id: "c2", name: "Goblin 2", entityId: "gob", kind: "monster" },
      { id: "m1", name: "Mira", entityId: "mira", kind: "character" },
      { id: "c3", name: "Fire Elemental 3", entityId: "fire", kind: "monster" },
      { id: "c4", name: "Fire Elemental 3", entityId: "fire", kind: "monster" },
    ],
    tokens: [
      { name: "Goblin 2", definitionId: "gob" },
      { name: "Scarface", definitionId: "gob" },
      { name: "Scarface", definitionId: "gob" },
      { name: "Twin", definitionId: "gob" },
      { name: "Twin", definitionId: "orc" },
      { name: "A player's view" },
    ],
  });

  test("FR-DICE-103 actor lookup: a global definition (not in the store) resolves through its tokens and combatants", () => {
    const r = creatures();
    expect(actorCreature("Goblin 2", r)).toEqual({ id: "gob", kind: "monster", combatantId: "c2" });
    expect(actorCreature("mira", r)).toEqual({ id: "mira", kind: "character" });
  });

  test("FR-DICE-103 actor lookup: several of one name on ONE definition are one creature; two definitions or none → absent", () => {
    const r = creatures();
    expect(actorCreature("Scarface", r)).toEqual({ id: "gob", kind: "monster" });
    expect(actorCreature("Fire Elemental 3", r)).toEqual({ id: "fire", kind: "monster" });
    expect(actorCreature("Twin", r)).toBeNull();
    expect(actorCreature("DM", r)).toBeNull();
    expect(actorCreature("A player's view", r)).toBeNull();
  });

  test("FR-DICE-103 the item reads by kind: a character's sheet, a monster's stat block", () => {
    const labelOf = (kind: "character" | "monster") =>
      entryMenuItems({
        entry: entry(),
        isDm: true,
        live: true,
        landed: true,
        actions: [],
        creature: { id: "x", kind },
      }).find((i) => i.value === "sheet")?.label;
    expect(labelOf("character")).toBe("Open sheet");
    expect(labelOf("monster")).toBe("Stat block");
  });
});

describe("FR-DICE-104 copy to dice tray", () => {
  test("FR-DICE-104 the tray gets the expression as asked: advantage isn't applied twice", () => {
    expect(trayRequestOf(entry())).toEqual({
      kind: "free",
      expression: "1d20+5",
      mode: "advantage",
      category: "skill-check",
      label: "Athletics",
    });
    const dis = item({ expression: "1d4+2d20kl1", mode: "disadvantage", label: null });
    expect(trayRequestOf(entry({ payload: [dis] }))).toEqual({
      kind: "free",
      expression: "1d4+1d20",
      mode: "disadvantage",
      category: "skill-check",
    });
  });

  test("FR-DICE-104 baseExpression: only the mode's own term; normal rolls unchanged", () => {
    expect(baseExpression("2d20kh1+4", "normal")).toBe("2d20kh1+4");
    expect(baseExpression("2d20kl1+4", "advantage")).toBe("2d20kl1+4");
    expect(baseExpression("2d20kh1+2d20kh1", "advantage")).toBe("1d20+2d20kh1");
    expect(baseExpression("1d6", "advantage")).toBe("1d6");
  });

  test("FR-DICE-104 the line's label: a stored 'Mira — ' prefix is left out (BL-162); several rolls or other kinds → nothing", () => {
    const named = item({ label: "Mira — Athletics" });
    expect(trayRequestOf(entry({ payload: [named] }))).toMatchObject({ label: "Athletics" });
    expect(trayRequestOf(entry({ payload: [item(), item({ rollId: "r2" })] }))).toBeNull();
    expect(trayRequestOf(attack())).toBeNull();
  });
});

describe("FR-DICE-104 the tray's actor", () => {
  const options = (labels: [string, Record<string, string> | undefined][]) =>
    labels.map(([label, ref], i) => ({
      value: String(i),
      label,
      ...(ref ? { ref } : {}),
    })) as never;

  test("FR-DICE-104 an actor that is exactly one of the viewer's options rolls as them", () => {
    const pet = options([
      ["Me", undefined],
      ["Owlbear", { tokenId: "t1" }],
    ]);
    const line = entry({ actorName: "Owlbear" });
    expect(trayRequestOf(line, pet)).toMatchObject({ actor: { tokenId: "t1" } });
  });

  test("FR-DICE-104 no match, two matches or the roller's own option → the default actor", () => {
    const line = entry({ actorName: "Owlbear" });
    expect(trayRequestOf(line, options([["Me", undefined]]))).not.toHaveProperty("actor");
    const two = options([
      ["Owlbear", { tokenId: "t1" }],
      ["Owlbear", { tokenId: "t2" }],
    ]);
    expect(trayRequestOf(line, two)).not.toHaveProperty("actor");
    const dm = entry({ actorName: "DM" });
    expect(trayRequestOf(dm, options([["DM", undefined]]))).not.toHaveProperty("actor");
  });
});

describe("FR-DICE-99 the client's send", () => {
  const send = (reject?: Error) => {
    const sent: unknown[] = [];
    const guarded: string[] = [];
    const connection = {
      sendIntent(name: string, payload: unknown) {
        sent.push([name, payload]);
        return reject ? Promise.reject(reject) : Promise.resolve({});
      },
    };
    return { sent, guarded, connection, onGuarded: (id: string) => guarded.push(id) };
  };

  test("FR-DICE-100 a guarded refusal asks; the confirm resends with confirmGuarded", async () => {
    const a = send(new IntentRejected("conflict", REVEAL_GUARDED));
    await sendEntryHidden(a.connection, "e1", false, a.onGuarded);
    expect(a.sent).toEqual([["dice.setEntryHidden", { entryId: "e1", hidden: false }]]);
    expect(a.guarded).toEqual(["e1"]);
    const b = send();
    await sendEntryHidden(b.connection, "e1", false, b.onGuarded, true);
    expect(b.sent).toEqual([
      ["dice.setEntryHidden", { entryId: "e1", hidden: false, confirmGuarded: true }],
    ]);
    expect(b.guarded).toEqual([]);
  });

  test("FR-DICE-99 any other refusal doesn't ask", async () => {
    const a = send(new IntentRejected("conflict", "Something else"));
    await sendEntryHidden(a.connection, "e1", true, a.onGuarded);
    expect(a.guarded).toEqual([]);
  });
});

function render(el: ReactElement, entries: GameLogEntryView[], role: "dm" | "player" = "player") {
  const you = { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" };
  const store = {
    ...emptyStore(),
    you,
    records: {
      [GAME_LOG_ENTRY_TYPE]: Object.fromEntries(entries.map((e) => [e.id, e])),
      player: { p1: { id: "p1", name: "Player 1" } },
    },
  } as unknown as RecordStore;
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store,
        notLiveSince: null,
        everLive: true,
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {el}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const count = (html: string, testId: string) => html.split(`data-testid="${testId}"`).length - 1;

const open = (entries: GameLogEntryView[], role: "dm" | "player" = "player") => {
  openRollDetails("e1");
  return render(<RollDetails />, entries, role);
};

/** A DM's `cbt.attack` facts. */
const dmFacts = (o: Record<string, unknown> = {}) => ({
  targetAc: 13,
  hitComputed: true,
  toHitRolled: 16,
  damageRolled: 7,
  damageTotal: 7,
  applied: 7,
  overkill: 0,
  overrides: { toHit: false, hit: false, damage: false },
  ...o,
});
const STORED = {
  toHit: {
    expression: "2d20kh1+4",
    mode: "advantage",
    dice: [
      [12, true],
      [3, false],
    ],
    constant: 4,
  },
  damage: { expression: "1d8+3", dice: [[4, true]], constant: 3, crit: false },
};

describe("FR-DICE-106 the details window", () => {
  test("FR-DICE-109 empty state: nothing picked, and a picked line that left the store, read the same", () => {
    const none = render(<RollDetails />, [entry()]);
    expect(none).toContain("Pick a roll in the log");
    openRollDetails("gone");
    expect(render(<RollDetails />, [entry()])).toBe(none);
    expect(none).not.toContain('data-testid="dice-details"');
  });

  test("FR-DICE-106 one window follows the row picked", () => {
    openRollDetails("e1");
    const seq = rollDetails.getState().seq;
    openRollDetails("e2");
    expect(rollDetails.getState()).toEqual({ entryId: "e2", seq: seq + 1 });
    const html = render(<RollDetails />, [entry(), entry({ id: "e2", n: 2 })]);
    expect(html).toContain('data-testid="dice-details" data-record-id="e2"');
  });

  test("FR-DICE-107 one equation: the dice, then '+ 5', '=', a big total, on one row; the die is the 60-px one, the dropped one struck", () => {
    const html = open([entry()]);
    expect(count(html, "dice-details-equation")).toBe(1);
    expect(count(html, "dice-details-die")).toBe(2);
    expect(html).toMatch(/<s data-testid="dice-details-die"[^>]*data-value="4"/);
    expect(html).toContain('width="60"');
    expect(html.match(/data-testid="dice-details-term"[^>]*>([^<]*)</)?.[1]).toBe("+ 5");
    expect(html).toMatch(/data-testid="dice-details-total"[^>]*>18</);
    expect(html).not.toContain("Constant");
  });

  test("FR-DICE-107 a d20 at 60 px has no facet lines through its digit; a dropped die isn't faint", () => {
    const html = open([entry()]);
    expect(html).not.toContain("M50 22 L76 67");
    expect(html).not.toContain("opacity-40");
  });

  test("FR-DICE-107 the expression is said once and as typed: 1d20+5 · Advantage, never the baked 2d20kh1; a label in the header; no section chrome on one roll", () => {
    const html = open([entry()]);
    expect(html).toMatch(/data-testid="dice-details-what"[^>]*> · Athletics</);
    expect(html).toMatch(/data-testid="dice-details-expression"[^>]*>1d20\+5</);
    expect(html).toMatch(/data-testid="dice-details-mode"[^>]*>Advantage</);
    expect(html).not.toContain("2d20kh1");
    expect(html).not.toContain("dice-details-heading");
  });

  test("FR-DICE-107 no label: the header names nothing, the expression below says it once", () => {
    const plain = item({ label: null });
    const html = open([entry({ payload: [plain] })]);
    expect(html).not.toContain("dice-details-what");
    expect(count(html, "dice-details-expression")).toBe(1);
    expect(html).not.toContain("2d20kh1");
  });

  test("FR-DICE-107 outcome is loud, in the outcome colours: natural 20 good, natural 1 bad, a save's note", () => {
    const nat = (natural: number, o: Partial<RollPayloadItem> = {}) =>
      open([entry({ payload: [item({ natural, ...o })] })]);
    expect(nat(20)).toMatch(/data-tone="good"[^>]*text-hp-full[^>]*>Natural 20!/);
    expect(nat(1)).toMatch(/data-tone="bad"[^>]*text-destructive[^>]*>Natural 1</);
    expect(nat(7, { note: "success (2 / 0)" })).toMatch(/data-tone="good"[^>]*>Success \(2 \/ 0\)/);
    expect(nat(7, { note: "lost" })).toMatch(/data-tone="bad"[^>]*>Lost</);
    expect(nat(7)).not.toContain("dice-details-outcome");
    const initiative = open([entry({ category: "initiative", payload: [item({ natural: 20 })] })]);
    expect(initiative).not.toContain("Natural 20");
  });

  test("FR-DICE-107 named modifiers: a small list under the equation; the equation still adds up", () => {
    const e = entry({
      payload: [item({ total: 21, mods: [{ label: "Bless", value: 3 }] })],
    });
    const html = open([e]);
    const terms = [...html.matchAll(/data-testid="dice-details-term"[^>]*>([^<]*)</g)].map(
      (m) => m[1],
    );
    expect(terms).toEqual(["+ 5", "+ 3"]);
    expect(html).toMatch(
      /data-testid="dice-details-line"[^>]*><span[^>]*>\+ 3<\/span><span[^>]*>Bless</,
    );
  });

  test("FR-DICE-107 several rolls: a short heading per roll with its own expression; offered parts, tags", () => {
    const e = entry({
      category: "attack",
      payload: [
        item({ rollId: "r1", purpose: "attack", edited: true }),
        item({
          rollId: "r2",
          expression: "1d8",
          mode: "normal",
          dice: [{ faces: 8, value: 6, kept: true }],
          constant: 0,
          total: 6,
          natural: null,
          label: null,
          purpose: "damage",
          part: { type: "fire", extra: false },
          offered: [
            { label: "Divine Fury", value: 4, expression: "1d6", rollId: "o1", type: "radiant" },
          ],
        }),
      ],
    });
    const html = open([e]);
    expect(count(html, "dice-details-roll")).toBe(2);
    const headings = [...html.matchAll(/data-testid="dice-details-heading"[^>]*>([^<]*)</g)].map(
      (m) => m[1],
    );
    expect(headings).toEqual(["To hit", "Damage (fire)"]);
    expect(count(html, "dice-details-expression")).toBe(2);
    expect(html).toContain('data-record-id="r2"');
    expect(html).toContain("Edited");
    expect(html).toContain("Divine Fury");
    expect(html).toContain("1d6: 4 radiant");
    expect(count(html, "dice-details-offered")).toBe(1);
  });

  test("FR-DICE-107 compact footer: one muted row, category · time, no field labels; the rerolled link and physical in it", () => {
    const e = entry({ supersededBy: "e2", payload: [item({ manual: true })] });
    const html = open([e]);
    expect(html).toContain("Skill check");
    expect(html).toContain(new Date(e.at).toLocaleTimeString());
    expect(html).not.toContain("Category");
    expect(html).not.toContain(">Time<");
    expect(html).not.toContain("Who can see");
    expect(html).toMatch(/data-testid="dice-details-rerolled" data-record-id="e2"/);
    expect(html).toContain('data-testid="dice-details-physical"');
    const undone = open([entry({ supersededBy: "e2", undone: true })]);
    expect(undone).not.toContain("dice-details-rerolled");
    expect(undone).toContain("dice-details-undone");
  });

  test("FR-DICE-107 cbt.attack, player: to-hit and damage sections; the dice are the payload's sum, no DM facts; the outcome as their line says it", () => {
    const html = open([attack()]);
    expect(count(html, "dice-details-roll")).toBe(2);
    expect(count(html, "dice-details-die")).toBe(1);
    expect(html).toContain('data-value="12"');
    expect(html).toContain("Longbow attack vs Goblin");
    expect(html).toContain("Damage (piercing)");
    expect(html).toMatch(/data-testid="dice-details-outcome"[^>]*>DM: hit</);
    expect(html).not.toContain("dice-details-expression");
    const miss = detailSections(attack({}, { hit: false }));
    expect(miss.map((s) => [s.key, s.outcomes.at(-1)?.text])).toEqual([["hit", "DM: miss"]]);
  });

  test("FR-DICE-107 cbt.attack, DM: the stored dice (dropped struck), the expressions as typed", () => {
    const e = attack({ dmPayload: dmFacts({ rolls: STORED }) });
    const html = open([e], "dm");
    expect(count(html, "dice-details-die")).toBe(3);
    expect(html).toMatch(/<s data-testid="dice-details-die"[^>]*data-value="3"/);
    expect(html).toMatch(/data-testid="dice-details-expression"[^>]*>1d20\+4</);
    expect(html).toMatch(/data-testid="dice-details-expression"[^>]*>1d8\+3</);
    expect(html).toMatch(/data-testid="dice-details-outcome"[^>]*>Hit!</);
  });

  test("FR-DICE-107 DM-set to-hit, DM: no breakdown sum; the total with 'Set by DM' and 'Rolled 13'", () => {
    const e = attack(
      {
        dmPayload: dmFacts({
          toHitRolled: 13,
          overrides: { toHit: true, hit: false, damage: false },
          rolls: { toHit: STORED.toHit },
        }),
      },
      { toHit: { dice: null, constant: 4, total: 15, natural: null }, hit: false },
    );
    const [hit] = detailSections(e);
    expect(hit?.dice).toEqual([]);
    expect(hit?.terms).toEqual([]);
    expect(hit?.lines).toEqual([]);
    expect(hit?.tags).toEqual(["Set by DM", "Rolled 13"]);
    expect(hit?.total).toBe(15);
  });

  test("FR-DICE-107 DM-set to-hit, player: the total alone, as their line says; nothing about the DM setting it", () => {
    const e = attack(
      {},
      { toHit: { dice: null, constant: 4, total: 15, natural: null }, hit: false },
    );
    const [hit] = detailSections(e);
    expect(hit?.dice).toEqual([]);
    expect(hit?.terms).toEqual([]);
    expect(hit?.tags).toEqual([]);
    const html = open([e]);
    expect(html).not.toContain("Set by DM");
    expect(html).not.toContain("+ 4");
    expect(html).toMatch(/data-testid="dice-details-total"[^>]*>15</);
  });

  test("FR-DICE-107 no sum that doesn't add up: DM-set damage, halved damage, a maxed die: the total alone", () => {
    const set = attack({
      dmPayload: dmFacts({
        damageRolled: 7,
        overrides: { toHit: false, hit: false, damage: true },
        rolls: STORED,
      }),
    });
    const setDamage = detailSections(set).at(-1);
    expect(setDamage?.dice).toEqual([]);
    expect(setDamage?.tags).toEqual(["Set by DM", "Rolled 7"]);
    const half = attack(
      { dmPayload: dmFacts({ rolls: STORED }) },
      { damage: 3, multiplier: "half" },
    );
    const halved = detailSections(half).at(-1);
    expect(halved?.dice).toEqual([]);
    expect(halved?.terms).toEqual([]);
    expect(halved?.tags).toContain("Half");
    // Dice that do add up keep their equation.
    const whole = detailSections(attack({ dmPayload: dmFacts({ rolls: STORED }) })).at(-1);
    expect(whole?.dice).toHaveLength(1);
    expect(whole?.terms).toEqual([{ value: 3, rolled: false }]);
  });

  test("FR-DICE-107 a player's damage with parts lists what their line tells, and those add up to the total", () => {
    const e = attack(
      {},
      {
        damage: 25,
        damageParts: [{ type: "fire", value: 4, multiplier: "half" }],
        parts: [{ label: "Divine Fury", value: 6, type: "radiant" }],
      },
    );
    const damage = detailSections(e).at(-1);
    expect(damage?.dice).toEqual([]);
    expect(damage?.lines.map((l) => [l.value, l.label])).toEqual([
      ["15", "piercing"],
      ["+ 4", "fire (half)"],
      ["+ 6 radiant", "Divine Fury"],
    ]);
  });

  test("FR-DICE-107 lines without dice: the full line at body size with the header; no name repeated", () => {
    const hp = entry({
      kind: "cbt.hp",
      category: "damage",
      actorName: "Mira",
      payload: { targetName: "Goblin", kind: "damage", amount: 5, sourced: true },
    });
    const html = open([hp]);
    expect(count(html, "dice-details-roll")).toBe(0);
    expect(count(html, "dice-details-actor")).toBe(1);
    const text = html.match(/data-testid="dice-details-text"[^>]*>(.*?)<\/p>/)?.[1] ?? "";
    expect(text).toContain("Goblin");
    expect(text).not.toContain("Mira");
    expect(entryPhysical(hp)).toBe(false);
  });

  test("FR-DICE-107 a line whose actor isn't first stays whole, with no name in the header", () => {
    expect(
      lineWithoutActor([{ text: "DM awards " }, { text: "Thorn", style: "actor" }]).actor,
    ).toBeNull();
    expect(lineWithoutActor([{ text: "Mira", style: "actor" }, { text: " — rests" }])).toEqual({
      actor: "Mira",
      rest: [{ text: "rests" }],
    });
  });

  test("FR-DICE-109 held: blank dice and no totals, modifiers, mode or natural until the landing", () => {
    const e = entry({
      payload: [item({ natural: 20, total: 21, mods: [{ label: "Bless", value: 3 }] })],
    });
    landing.api.setState({ holding: new Map([["e1", Number.MAX_SAFE_INTEGER]]) });
    const held = open([e]);
    expect(held).toContain('data-landed="false"');
    expect(count(held, "dice-details-die")).toBe(2);
    expect(held).not.toMatch(/data-testid="dice-details-die"[^>]*data-value=/);
    expect(held).not.toContain(">21<");
    expect(held).not.toContain("Natural 20");
    expect(held).not.toContain("dice-details-mode");
    expect(held).not.toContain("+ 3");
    expect(held).toContain("…");
    landing.api.setState({ holding: new Map() });
    const shown = open([e]);
    expect(shown).toContain(">21<");
    expect(shown).toContain("Natural 20!");
  });

  test("FR-DICE-108 DM names show only from dmPayload; a held line shows no extras; the player's window gets none", () => {
    const Extras = () => <p>DM-EXTRA</p>;
    const e = entry({
      payload: [item({ total: 20, mods: [{ label: null, value: 2 }] })],
      dmPayload: { items: [{ mods: [{ effectId: "ef", label: "Hunter's Mark" }] }] },
    });
    openRollDetails("e1");
    const dm = render(<RollDetails Extras={Extras} />, [e], "dm");
    expect(dm).toContain("Hunter&#x27;s Mark");
    expect(dm).toContain("DM-EXTRA");
    const redacted = entry({ payload: [item({ total: 20, mods: [{ label: null, value: 2 }] })] });
    const player = open([redacted]);
    expect(player).toContain("(DM)");
    expect(player).not.toContain("Hunter");
    landing.api.setState({ holding: new Map([["e1", Number.MAX_SAFE_INTEGER]]) });
    expect(render(<RollDetails Extras={Extras} />, [e], "dm")).not.toContain("DM-EXTRA");
  });
});

describe("FR-DICE-103 the row", () => {
  test("FR-DICE-103 a row keeps its data-* and test IDs under the menu trigger; the menu renders nothing until it opens", () => {
    const html = render(<GameLog />, [entry()]);
    expect(html).toMatch(/data-testid="dice-log-entry"[^>]*data-record-id="e1"/);
    expect(html).toContain('data-public="true"');
    expect(html).not.toContain("dice-log-menu");
  });
});
