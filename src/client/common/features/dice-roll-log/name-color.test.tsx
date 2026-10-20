// FR-DICE-60, -61 (DICE §13 unit, sprint 5 K4): static `GameLog` render over a fake store built
// from the entry shapes the server writes: `dice.roll` (player: actor = the player or their
// character; DM: any actor), the sheet's roll command (`kind: "roll"`, actor = the character) and
// combat's apply (`cbt.attack` / `cbt.hp`, appended by the DM: `rollerRole: "dm"`). Plus the roll
// popup's name (OQ-DICE-40 A).
import { describe, expect, test } from "bun:test";
import { type PaletteKey, PLAYER_COLORS } from "@shared/campaign-management/colors";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore, type StoreApi } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { GameLog } from "./GameLog";
import { RollerName } from "./name-color";

const P1 = "pl-1";
const P2 = "pl-2";

const rollItem = (label: string, total: number) => ({
  rollId: `r-${label}`,
  expression: "1d20+5",
  mode: "normal",
  manual: false,
  dice: [{ faces: 20, value: total - 5, kept: true }],
  constant: 5,
  total,
  natural: total - 5,
  label,
});

const base: Pick<
  GameLogEntryView,
  "campaignId" | "at" | "public" | "undone" | "rollIds" | "encounterId" | "supersededBy"
> = {
  campaignId: "c1",
  at: "2026-10-19T10:00:00.000Z",
  public: true,
  undone: false,
  rollIds: [],
  encounterId: null,
  supersededBy: null,
};

/** `player-1`'s `dice.roll` from the roll bar, no actor: the player's own name. */
const p1Bar: GameLogEntryView = {
  ...base,
  id: "e1",
  n: 1,
  kind: "roll",
  category: "other",
  rollerRole: "player",
  rollerPlayerId: P1,
  actorName: "Player 1",
  payload: [rollItem("1d20", 14)],
};
/** `player-1`'s sheet check (character-sheet `roll`): actor = Mira. */
const p1Sheet: GameLogEntryView = {
  ...p1Bar,
  id: "e2",
  n: 2,
  category: "skill-check",
  actorName: "Mira",
  payload: [rollItem("Athletics", 18)],
};
/** The DM's `dice.roll` for Mira (`actor: {entityId}`): the DM is the roller. */
const dmForMira: GameLogEntryView = {
  ...p1Bar,
  id: "e3",
  n: 3,
  category: "saving-throw",
  rollerRole: "dm",
  rollerPlayerId: null,
  actorName: "Mira",
  payload: [rollItem("DEX save", 11)],
};
/** `player-2`'s attack to-hit from Thorn's sheet (`roll`, category attack). */
const p2ToHit: GameLogEntryView = {
  ...p1Bar,
  id: "e4",
  n: 4,
  category: "attack",
  rollerPlayerId: P2,
  actorName: "Thorn",
  payload: [rollItem("Longsword", 17)],
};
/** The DM's apply of Thorn's card: `cbt.attack`, stamped `dm` by the apply (review #5). */
const dmApply: GameLogEntryView = {
  ...base,
  id: "e5",
  n: 5,
  kind: "cbt.attack",
  category: "attack",
  rollerRole: "dm",
  rollerPlayerId: null,
  actorName: "Thorn",
  payload: {
    targetName: "Goblin",
    attackName: "Longsword",
    damageType: "slashing",
    toHit: { dice: 12, constant: 5, total: 17, natural: 12 },
    hit: true,
    damage: 7,
    multiplier: "normal",
    crit: false,
  },
  encounterId: "enc1",
};

function storeOf(
  entries: GameLogEntryView[],
  colors: { p1?: PaletteKey; p2?: PaletteKey; dm?: PaletteKey } = {},
  role: "dm" | "player" = "player",
): RecordStore {
  const byId = <T extends { id: string }>(rows: T[]) =>
    Object.fromEntries(rows.map((r) => [r.id, r]));
  return {
    ...emptyStore(),
    you: { campaignId: "c1", role, playerId: role === "dm" ? null : P1 },
    records: {
      [GAME_LOG_ENTRY_TYPE]: byId(entries),
      campaign: byId([{ id: "c1", name: "Fixture Campaign", dmColor: colors.dm ?? "amber" }]),
      player: byId([
        { id: P1, campaignId: "c1", name: "Player 1", color: colors.p1 ?? "jade" },
        { id: P2, campaignId: "c1", name: "Player 2", color: colors.p2 ?? "blue" },
      ]),
    },
  } as unknown as RecordStore;
}

function syncOf(store: RecordStore): StoreApi<SyncState> {
  return createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store,
        notLiveSince: null,
        everLive: true,
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
}

const html = (sync: StoreApi<SyncState>, node: React.ReactNode = <GameLog />) =>
  renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );

/** Each entry's `<li>` opening tag and its line HTML, by record id. */
function lines(markup: string) {
  const out = new Map<string, { li: string; body: string }>();
  for (const m of markup.matchAll(/<li data-testid="dice-log-entry"([^>]*)>([\s\S]*?)<\/li>/g)) {
    const id = /data-record-id="([^"]+)"/.exec(m[1] ?? "")?.[1] ?? "";
    out.set(id, { li: m[1] ?? "", body: m[2] ?? "" });
  }
  return out;
}
const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1];
const actorTag = (body: string) =>
  /<strong data-testid="dice-log-entry-actor"[^>]*>/.exec(body)?.[0];
const styled = (body: string) => [...body.matchAll(/style="color:([^"]+)"/g)].map((m) => m[1]);

describe("FR-DICE-60 log name colour", () => {
  test("FR-DICE-60 log name colour: roll lines in the roller's colour; the DM's apply line neutral", () => {
    const all = [p1Bar, p1Sheet, dmForMira, p2ToHit, dmApply];
    for (const role of ["dm", "player"] as const) {
      const l = lines(html(syncOf(storeOf(all, {}, role))));
      expect(l.size).toBe(5);
      const check = (id: string, key: PaletteKey | undefined, roller: string) => {
        const e = l.get(id);
        if (!e) throw new Error(`no line ${id}`);
        expect(attr(e.li, "data-color")).toBe(key);
        expect(attr(e.li, "data-roller")).toBe(roller);
        const tag = actorTag(e.body) ?? "";
        // Bold kept; only the actor name is coloured (targets, totals, chips, badges plain).
        expect(tag).toContain("font-semibold");
        expect(styled(e.body)).toEqual(key ? [PLAYER_COLORS[key]] : []);
        if (key) expect(tag).toContain(`style="color:${PLAYER_COLORS[key]}"`);
      };
      check("e1", "jade", P1); // player-1's roll bar
      check("e2", "jade", P1); // player-1's sheet check (Mira)
      check("e3", "amber", "dm"); // the DM rolls for Mira → the DM's colour
      check("e4", "blue", P2); // player-2's to-hit (Thorn)
      check("e5", undefined, "dm"); // cbt.attack: DM-applied outcome, neutral (OQ-DICE-39 A′)
    }
  });

  test("FR-DICE-60 log name colour: a hidden roll keeps its muted styling with the name coloured (DM)", () => {
    const l = lines(html(syncOf(storeOf([{ ...dmForMira, public: false }], {}, "dm"))));
    const e = l.get("e3");
    expect(e?.li).toContain("text-visibility-hidden");
    expect(e?.body).toContain('data-testid="dice-log-entry-hidden"');
    expect(attr(e?.li ?? "", "data-color")).toBe("amber");
    expect(actorTag(e?.body ?? "")).toContain(`color:${PLAYER_COLORS.amber}`);
  });

  test("FR-DICE-60 log name colour: the roll popup row's name as its line (OQ-DICE-40 A)", () => {
    const sync = syncOf(storeOf([p1Sheet, dmForMira, dmApply]));
    const name = (id: string, n: string) => html(sync, <RollerName entryId={id} name={n} />);
    expect(name("e2", "Mira")).toBe(
      `<strong data-testid="dicex-popup-actor" data-color="jade" class="shrink-0 font-semibold" style="color:${PLAYER_COLORS.jade}">Mira</strong>`,
    );
    expect(name("e3", "Mira")).toContain(`data-color="amber"`);
    // Not a roll, or not in the store: plain.
    expect(name("e5", "Thorn")).not.toContain("data-color");
    expect(name("gone", "Goblin")).not.toContain("style=");
  });
});

describe("FR-DICE-61 kinds and fallback", () => {
  test("FR-DICE-61 kinds and fallback: other kinds neutral without kind code, unknown roller neutral, recolour, old entries", () => {
    // cbt.hp and cbt.side: kinds GameLog has no code for; neutral by the `roll` rule alone.
    const hp: GameLogEntryView = {
      ...dmApply,
      id: "e6",
      n: 6,
      kind: "cbt.hp",
      category: "damage",
      actorName: "DM",
      payload: { targetName: "Mira", kind: "damage", amount: 5 },
    };
    const side: GameLogEntryView = {
      ...dmApply,
      id: "e7",
      n: 7,
      kind: "cbt.side",
      category: "other",
      // Even with a player stamp a non-roll kind stays neutral.
      rollerRole: "player",
      rollerPlayerId: P1,
      actorName: "Mira",
      payload: { targetName: "Goblin", side: "ally" },
      dmPayload: { secret: false },
    };
    // A roller whose `player` row is gone → the default text colour (no role accent in text).
    const ghost: GameLogEntryView = { ...p1Bar, id: "e8", n: 8, rollerPlayerId: "pl-gone" };
    // A pre-sprint-5 entry: the same fields (`rollerRole` / `rollerPlayerId` since MVP).
    const old: GameLogEntryView = {
      ...p2ToHit,
      id: "e9",
      n: 9,
      at: "2026-03-01T19:00:00.000Z",
      category: "damage",
    };
    // The DM's view: `cbt.side` names its actor only there.
    const sync = syncOf(storeOf([hp, side, ghost, old], {}, "dm"));
    let l = lines(html(sync));
    for (const id of ["e6", "e7", "e8"]) {
      expect(attr(l.get(id)?.li ?? "", "data-color")).toBeUndefined();
      expect(styled(l.get(id)?.body ?? "")).toEqual([]);
      expect(actorTag(l.get(id)?.body ?? "")).toBeDefined();
    }
    expect(attr(l.get("e8")?.li ?? "", "data-roller")).toBe("pl-gone");
    expect(attr(l.get("e9")?.li ?? "", "data-color")).toBe("blue");

    // A `player` upsert with a new colour recolours the name: derived from the store at render,
    // nothing copied on the entry (OQ-CAMP-21; the live re-render is e2e K6).
    l = lines(html(syncOf(storeOf([hp, side, ghost, old], { p2: "rose" }, "dm"))));
    expect(attr(l.get("e9")?.li ?? "", "data-color")).toBe("rose");
    expect(styled(l.get("e9")?.body ?? "")).toEqual([PLAYER_COLORS.rose]);
  });

  test("FR-DICE-61 kinds and fallback: an unknown DM colour key → neutral, not the role accent", () => {
    const store = storeOf([dmForMira]);
    (store.records.campaign as Record<string, { dmColor: string }>).c1 = {
      ...(store.records.campaign?.c1 as { dmColor: string }),
      dmColor: "chartreuse",
    };
    const l = lines(html(syncOf(store)));
    expect(attr(l.get("e3")?.li ?? "", "data-color")).toBeUndefined();
    expect(styled(l.get("e3")?.body ?? "")).toEqual([]);
  });
});
