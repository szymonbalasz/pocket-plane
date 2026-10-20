// FR-DICE-77 (sprint 7, BL-48): a player's roll bar rolls as the PC their sheet shows; a manual
// pick is stored with the Options state (FR-DICE-30's entry) and survives a reload; fallback order
// manual pick → the sheet's PC (own only) → the only PC → "Me". The DM's default is unchanged.
// Static render of `GameLog` over a fake sync store and an in-memory `localStorage`.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { sheetSelection } from "../character-sheet/selection";
import { pickerModel, shownSheetId } from "../character-sheet/view-model";
import { GameLog } from "./GameLog";
import {
  type ActorOption,
  actorOptions,
  createFlagStore,
  type FlagBackend,
  optionsKey,
  playerActorPick,
} from "./logic";

const data = new Map<string, string>();
const backend: FlagBackend = {
  getItem: (k) => data.get(k) ?? null,
  setItem: (k, v) => {
    data.set(k, v);
  },
};
const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", { value: backend, configurable: true });
});
afterAll(() => {
  if (had) Object.defineProperty(globalThis, "localStorage", had);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
afterEach(() => {
  data.clear();
  sheetSelection.setState({ selectedId: null, npcId: null, editId: null });
});

const char = (id: string, name: string, ownerPlayerId: string) => ({
  id,
  kind: "character" as const,
  name,
  ownerPlayerId,
  // The sheet's picker lists only characters with a stat block (`pickerModel`).
  statBlock: {},
});
const MIRA = char("mira", "Mira", "p1");
const BRAKKA = char("brakka", "Brakka", "p1");
const THORN = char("thorn", "Thorn", "p2");
const ENTITIES = [MIRA, BRAKKA, THORN];
const P1 = { role: "player" as const, playerId: "p1" };

function render(role: "dm" | "player", entities = ENTITIES) {
  const you = { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" };
  const store = {
    ...emptyStore(),
    you,
    records: {
      [GAME_LOG_ENTRY_TYPE]: {},
      entity: Object.fromEntries(entities.map((e) => [e.id, e])),
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
        <GameLog />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/** The roll bar's actor Select: its options and the selected one (Options row open). */
function actorSelect(html: string) {
  const select = /<select[^>]*data-testid="dice-roll-actor"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  const opts = [...(select?.[1] ?? "").matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)/g)];
  return {
    labels: opts.map((m) => m[3]),
    selected: opts.find((m) => m[2])?.[3] ?? opts[0]?.[3],
  };
}

const openOptions = (playerId: string | null, actor?: string) => {
  const key = optionsKey("c1", playerId ? "player" : "dm", playerId);
  data.set(key, actor === undefined ? "1" : JSON.stringify({ open: true, actor }));
};

describe("FR-DICE-77 roll as your PC", () => {
  test("FR-DICE-77 roll as your PC: player-1 with the sheet on Mira → Mira; Me still selectable; a manual Brakka pick survives a reload; another player's PC on the sheet → Me; DM unchanged", () => {
    openOptions("p1");
    sheetSelection.setState({ selectedId: "mira" });
    const p1 = actorSelect(render("player"));
    expect(p1.labels).toEqual(["Me", "Brakka", "Mira"]);
    expect(p1.selected).toBe("Mira");

    // A manual pick of Brakka, stored with the Options state (same entry), wins after a reload.
    openOptions("p1", "brakka");
    expect(actorSelect(render("player")).selected).toBe("Brakka");
    // A manual "Me" sticks too (the line then names the player).
    openOptions("p1", "");
    expect(actorSelect(render("player")).selected).toBe("Me");

    // The sheet on another player's character (Thorn) is skipped: two own PCs → "Me".
    openOptions("p1");
    sheetSelection.setState({ selectedId: "thorn" });
    expect(actorSelect(render("player")).selected).toBe("Me");

    // The DM: unchanged ("DM"), whatever the sheet shows.
    openOptions(null);
    sheetSelection.setState({ selectedId: "mira" });
    expect(actorSelect(render("dm")).selected).toBe("DM");
  });

  test("FR-DICE-77 roll as your PC, the sheet's default (walkthrough U17): a fresh browser (no Options / sheet entry, nothing picked), player-1 with Mira and Brakka → the sheet shows Brakka (its first own PC) and the roll bar rolls as Brakka", () => {
    // Nothing stored but the Options row open, so the Select renders; `sheetSelection` untouched.
    openOptions("p1");
    expect(sheetSelection.getState().selectedId).toBeNull();
    const viewer = { role: "player" as const, playerId: "p1" };
    expect(shownSheetId(pickerModel(ENTITIES, {}, viewer, [], null).options, null)).toBe("brakka");
    expect(actorSelect(render("player")).selected).toBe("Brakka");
    // A pick in the sheet's picker moves the default with it.
    sheetSelection.setState({ selectedId: "mira" });
    expect(actorSelect(render("player")).selected).toBe("Mira");
    // A stored sheet choice that is no longer eligible: the sheet falls back to Brakka, so does the bar.
    sheetSelection.setState({ selectedId: "gone" });
    expect(actorSelect(render("player")).selected).toBe("Brakka");
  });

  test("FR-DICE-77 fallback order: manual pick (still the player's) → the sheet's own PC → the only PC → Me", () => {
    const actors: ActorOption[] = actorOptions(P1, ENTITIES);
    const pick = (stored: string | null, sheet: string | null, list = actors) =>
      playerActorPick(list, stored, sheet)?.label ?? "Me";
    expect(pick("brakka", "mira")).toBe("Brakka");
    expect(pick("", "mira")).toBe("Me");
    // A stored pick that is no longer the player's → the sheet's PC.
    expect(pick("thorn", "mira")).toBe("Mira");
    expect(pick("gone", "mira")).toBe("Mira");
    expect(pick(null, "thorn")).toBe("Me");
    expect(pick(null, null)).toBe("Me");
    // One own character: that one by default.
    const one = actorOptions(P1, [MIRA, THORN]);
    expect(pick(null, null, one)).toBe("Mira");
    expect(pick(null, "thorn", one)).toBe("Mira");
  });

  test("FR-DICE-77 the pick lives in the Options entry: '1' / '0' without one, JSON with one; reload reads both", () => {
    const store = createFlagStore(() => backend);
    const key = optionsKey("c1", "player", "p1");
    store.write(key, true);
    expect(data.get(key)).toBe("1");
    store.writeActor(key, "brakka");
    expect(JSON.parse(data.get(key) as string)).toEqual({ open: true, actor: "brakka" });
    store.write(key, false);
    const reloaded = createFlagStore(() => backend);
    expect(reloaded.read(key)).toBe(false);
    expect(reloaded.readActor(key)).toBe("brakka");
    store.writeActor(key, null);
    expect(data.get(key)).toBe("0");
    // A broken entry reads as the default.
    data.set(key, "{oops");
    expect([reloaded.read(key), reloaded.readActor(key)]).toEqual([false, null]);
  });
});
