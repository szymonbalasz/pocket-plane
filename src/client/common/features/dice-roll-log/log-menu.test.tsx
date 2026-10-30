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
import { detailSections, entryPhysical } from "./details-model";
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

  test("FR-DICE-103 not live: what sends is disabled, what copies or shows is not", () => {
    const action = { id: "gem.reroll", label: "Inspiration: reroll", Icon: SparklesIcon };
    const items = entryMenuItems({
      entry: entry({ supersededBy: "e2" }),
      isDm: true,
      live: false,
      landed: true,
      actions: [action],
      creature: { id: "mira", kind: "character" },
    });
    expect(items.filter((i) => i.disabled).map((i) => i.value)).toEqual(["hide", "gem.reroll"]);
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

  test("FR-DICE-103 actor lookup: one creature by name, token or combatant; ambiguous or none → null", () => {
    const entities = [
      { id: "mira", kind: "character", name: "Mira" },
      { id: "gob", kind: "monster", name: "Goblin" },
      { id: "orc", kind: "monster", name: "Orc" },
    ] as Parameters<typeof actorCreature>[1]["entities"];
    const records = {
      entities,
      combatants: [{ name: "Goblin 2", entityId: "gob" }],
      tokens: [
        { name: "Boss", definitionId: "gob" },
        { name: "Twin", definitionId: "gob" },
        { name: "Twin", definitionId: "orc" },
        { name: "Player view", imageAssetId: null },
      ],
    };
    expect(actorCreature("mira", records)).toEqual({ id: "mira", kind: "character" });
    expect(actorCreature("Goblin 2", records)).toEqual({ id: "gob", kind: "monster" });
    expect(actorCreature("Boss", records)).toEqual({ id: "gob", kind: "monster" });
    expect(actorCreature("Twin", records)).toBeNull();
    expect(actorCreature("DM", records)).toBeNull();
    expect(actorCreature("Player view", records)).toBeNull();
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

  test("FR-DICE-107 a roll: its dice (dropped struck), constant, total, mode, category, time, physical", () => {
    const manual = entry({ payload: [item({ manual: true, natural: 20, total: 25 })] });
    openRollDetails("e1");
    const html = render(<RollDetails />, [manual]);
    expect(count(html, "dice-details-die")).toBe(2);
    expect(html).toMatch(/<s data-testid="dice-details-die"[^>]*data-value="4"/);
    expect(html).toContain("2d20kh1+5");
    expect(html).toContain("advantage");
    expect(html).toContain("+ 5");
    expect(html).toContain('data-testid="dice-details-total"');
    expect(html).toContain(">25<");
    expect(html).toContain("natural 20!");
    expect(html).toContain("Skill check");
    expect(html).toContain(new Date(manual.at).toLocaleString().replaceAll(" ", " "));
    expect(html).toContain('data-testid="dice-details-physical"');
  });

  test("FR-DICE-107 purpose, note, offered parts, edited and modifiers one per line; a section per roll", () => {
    const e = entry({
      payload: [
        item({
          rollId: "r1",
          note: "success (2 / 0)",
          purpose: "attack",
          edited: true,
          mods: [{ label: "Bless", value: 3 }],
        }),
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
    openRollDetails("e1");
    const html = render(<RollDetails />, [e]);
    expect(count(html, "dice-details-roll")).toBe(2);
    expect(html).toContain('data-record-id="r2"');
    expect(html).toContain("success (2 / 0)");
    expect(html).toContain("edited");
    expect(html).toContain("Bless");
    expect(html).toContain("fire");
    expect(html).toContain("Divine Fury");
    expect(html).toContain("1d6: 4 radiant");
    expect(count(html, "dice-details-offered")).toBe(1);
  });

  test("FR-DICE-107 a rerolled line links to the new one", () => {
    openRollDetails("e1");
    const html = render(<RollDetails />, [entry({ supersededBy: "e2" })]);
    expect(html).toMatch(/data-testid="dice-details-rerolled" data-record-id="e2"/);
    openRollDetails("e1");
    const undone = render(<RollDetails />, [entry({ supersededBy: "e2", undone: true })]);
    expect(undone).not.toContain("dice-details-rerolled");
    expect(undone).toContain("dice-details-undone");
  });

  test("FR-DICE-107 cbt.attack: to-hit and damage sections; a player's dice are the payload's sum, no DM facts", () => {
    openRollDetails("e1");
    const html = render(<RollDetails />, [attack()]);
    expect(count(html, "dice-details-roll")).toBe(2);
    expect(count(html, "dice-details-die")).toBe(1);
    expect(html).toContain('data-value="12"');
    expect(html).toContain("Longbow vs Goblin");
    expect(html).toContain("Damage (piercing)");
    expect(html).toContain(">hit<");
    expect(html).not.toContain("dice-details-expression");
    const miss = detailSections(attack({}, { hit: false }));
    expect(miss.map((s) => [s.key, s.outcomeText])).toEqual([["hit", "miss"]]);
  });

  test("FR-DICE-107 cbt.attack, DM: the stored dice (dropped struck), the expressions", () => {
    const rolls = {
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
    const e = attack({
      dmPayload: {
        targetAc: 13,
        hitComputed: true,
        toHitRolled: 16,
        damageRolled: 7,
        damageTotal: 7,
        applied: 7,
        overkill: 0,
        overrides: { toHit: false, hit: false, damage: false },
        rolls,
      },
    });
    openRollDetails("e1");
    const html = render(<RollDetails />, [e], "dm");
    expect(count(html, "dice-details-die")).toBe(3);
    expect(html).toMatch(/<s data-testid="dice-details-die"[^>]*data-value="3"/);
    expect(count(html, "dice-details-expression")).toBe(2);
  });

  test("FR-DICE-107 other kinds: the full line, wrapped, with category and time", () => {
    const hp = entry({
      kind: "cbt.hp",
      category: "damage",
      actorName: "Mira",
      payload: {
        targetName: "Goblin",
        kind: "damage",
        amount: 5,
        sourced: true,
      },
    });
    openRollDetails("e1");
    const html = render(<RollDetails />, [hp]);
    expect(count(html, "dice-details-roll")).toBe(0);
    expect(html).toContain('data-testid="dice-details-text"');
    expect(html).toContain("Damage");
    expect(entryPhysical(hp)).toBe(false);
  });

  test("FR-DICE-109 held: blank dice and no totals, modifiers, mode or natural until the landing", () => {
    const e = entry({
      payload: [item({ natural: 20, total: 25, mods: [{ label: "Bless", value: 3 }] })],
    });
    landing.api.setState({ holding: new Map([["e1", Number.MAX_SAFE_INTEGER]]) });
    openRollDetails("e1");
    const held = render(<RollDetails />, [e]);
    expect(held).toContain('data-landed="false"');
    expect(count(held, "dice-details-die")).toBe(2);
    expect(held).not.toMatch(/data-testid="dice-details-die"[^>]*data-value=/);
    expect(held).not.toContain(">25<");
    expect(held).not.toContain("natural 20");
    expect(held).not.toContain("dice-details-mode");
    expect(held).not.toContain("+ 3");
    expect(held).toContain("…");
    landing.api.setState({ holding: new Map() });
    const shown = render(<RollDetails />, [e]);
    expect(shown).toContain(">25<");
    expect(shown).toContain("natural 20!");
  });

  test("FR-DICE-108 DM names show only from dmPayload; a held line shows no extras; the player's window gets none", () => {
    const Extras = () => <p>DM-EXTRA</p>;
    const e = entry({
      payload: [item({ mods: [{ label: null, value: 2 }] })],
      dmPayload: { items: [{ mods: [{ effectId: "ef", label: "Hunter's Mark" }] }] },
    });
    openRollDetails("e1");
    const dm = render(<RollDetails Extras={Extras} />, [e], "dm");
    expect(dm).toContain("Hunter&#x27;s Mark");
    expect(dm).toContain("DM-EXTRA");
    const redacted = entry({ payload: [item({ mods: [{ label: null, value: 2 }] })] });
    const player = render(<RollDetails />, [redacted]);
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
