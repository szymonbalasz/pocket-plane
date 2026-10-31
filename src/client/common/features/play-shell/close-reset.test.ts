// FR-SHELL-200: each shared window type's `onClose` puts its view back (the shell's rule itself:
// `shell-store.test.ts`). Both clients register these bases; DM-only windows have their own test.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import {
  bindCompanionMemory,
  companionSelection,
  resetCompanionMemory,
  selectCompanion,
} from "../character-sheet/companion/picker";
import { companionWindowBase } from "../character-sheet/companion/window";
import {
  bindSheetMemory,
  createSheetMemory,
  resetSheetMemory,
  selectSheet,
  sheetSelection,
} from "../character-sheet/selection";
import { charSheetWindowBase } from "../character-sheet/window";
import { cmpNav, openEntry, resetCmpNav, setFilters, setQuery, setTab } from "../compendium/nav";
import { DEFAULT_PAGE } from "../compendium/rules/logic";
import {
  resetRulesNav,
  rulesNav,
  setCardOpen,
  setRulesPage,
  setRulesQuery,
} from "../compendium/rules/nav";
import { rulesWindowBase } from "../compendium/rules/window";
import { compendiumWindowBase } from "../compendium/window";
import { diceExtras } from "../dice-extras/store";
import { trayWindowBase } from "../dice-extras/window";
import { openRollDetails, rollDetails } from "../dice-roll-log/details";
import { diceDetailsWindowBase } from "../dice-roll-log/window";
import { STATUS_TAB } from "../party-board/logic";
import { tabKeyOf } from "../party-board/open-tab";
import { partyMemory } from "../party-board/seen";
import { handoutSelection, selectHandout } from "../party-board/selection";
import { partyBoardWindowBase, partyHandoutWindowBase } from "../party-board/window";
import { recapViews } from "../session-recap/open";
import { recapWindow } from "../session-recap/window";
import { DEFAULT_VIEW, statsViews, viewKey } from "../stats/view";
import { statsWindow } from "../stats/window";
import { holdMemory } from "../strongholds/memory";
import { strongholdWindow } from "../strongholds/window";

const you = { campaignId: "c1", role: "player", playerId: "p1" } as You;

function backend() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

// The page memories fall back to memory without `localStorage`: one console warning each.
let quiet: ReturnType<typeof spyOn>;
beforeEach(() => {
  quiet = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => quiet.mockRestore());

describe("FR-SHELL-200 close resets what the window shows", () => {
  test("FR-SHELL-200 Compendium: search, tab, filters and the open entry", () => {
    setQuery("goblin");
    setTab("spell");
    setFilters({ levels: [1] } as never);
    openEntry("e1");
    compendiumWindowBase.onClose();
    const s = cmpNav.getState();
    expect(s.q).toBe("");
    expect(s.tab).toBe("all");
    expect(s.filters).toEqual({});
    expect(s.view).toEqual({ mode: "list" });
    resetCmpNav();
  });

  test("FR-SHELL-200 Rules: page, search and open cards", () => {
    setRulesPage("other-page");
    setRulesQuery("grapple");
    setCardOpen("other-page", "card-1", true);
    rulesWindowBase.onClose();
    const s = rulesNav.getState();
    expect(s.page).toBe(DEFAULT_PAGE);
    expect(s.q).toBe("");
    expect(s.open).toEqual({});
    resetRulesNav();
  });

  test("FR-SHELL-200 FR-CHARX-47 Sheets: the picked creature, in the browser too", () => {
    const b = backend();
    resetSheetMemory(createSheetMemory(() => b));
    const key = "pp.sheet.v1.c1.p1";
    bindSheetMemory(key, () => "option");
    selectSheet("char-1");
    sheetSelection.setState({ npcId: "npc-1", editId: "char-1" });
    expect(JSON.parse(b.data.get(key) as string)).toEqual({ selectedId: "char-1" });
    charSheetWindowBase.onClose();
    expect(sheetSelection.getState()).toEqual({ selectedId: null, npcId: null, editId: null });
    expect(JSON.parse(b.data.get(key) as string)).toEqual({ selectedId: null });
    // The next page load starts on the default, with no "invalid memory" warning.
    const warn = spyOn(console, "warn");
    const reloaded = createSheetMemory(() => b);
    expect(reloaded.bind(key, null, () => "option")).toEqual({});
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    resetSheetMemory();
  });

  test("FR-SHELL-200 FR-CHARX-61 Companion: the picked companion, in the browser too", () => {
    const b = backend();
    resetCompanionMemory(createSheetMemory(() => b));
    const key = "pp.companion.v1.c1.p1";
    bindCompanionMemory(key, () => true);
    selectCompanion("pet-1");
    expect(companionSelection.getState().selectedId).toBe("pet-1");
    expect(JSON.parse(b.data.get(key) as string)).toEqual({ selectedId: "pet-1" });
    companionWindowBase.onClose();
    expect(companionSelection.getState().selectedId).toBeNull();
    expect(JSON.parse(b.data.get(key) as string)).toEqual({ selectedId: null });
    resetCompanionMemory();
  });

  test("FR-SHELL-200 FR-PARTY-11 Party Manager: back on the default tab", () => {
    const tabs = partyMemory().tabs;
    const key = tabKeyOf(you);
    tabs.choose(key, "loot");
    partyBoardWindowBase.onClose(you);
    expect(tabs.state.getState().tab).toBe(STATUS_TAB);
    expect(partyMemory().memory.readTab(key as string)).toBe(STATUS_TAB);
  });

  test("FR-SHELL-200 Handout: nothing selected", () => {
    selectHandout("h1", "edit");
    partyHandoutWindowBase.onClose();
    expect(handoutSelection.getState()).toEqual({ handoutId: null, mode: "view" });
  });

  test("FR-SHELL-200 FR-STATS-85 Stats: the default view", () => {
    const key = viewKey(you);
    statsViews().set(key, { tab: "fight", fightKey: "f1", sessionFromN: 3 });
    statsWindow.onClose?.(you);
    expect(statsViews().get(key)).toEqual(DEFAULT_VIEW);
  });

  test("FR-SHELL-200 Recap: the newest session", () => {
    const key = viewKey(you);
    recapViews().set(key, { fromN: 4 });
    recapWindow.onClose?.(you);
    expect(recapViews().get(key)).toEqual({ fromN: null });
  });

  test("FR-SHELL-200 FR-HOLD-23 Stronghold: nothing selected, the first tab", () => {
    const mem = holdMemory();
    mem.bind("pp.hold.v1.c1.p1");
    mem.select("s1");
    mem.chooseTab("staff");
    strongholdWindow.onClose?.(you);
    const s = mem.state.getState();
    expect(s.strongholdId).toBeNull();
    expect(s.tab).toBe("facilities");
  });

  test("FR-SHELL-200 FR-DICE-106 Roll details: no pick, and no reopen (`seq` stays)", () => {
    openRollDetails("entry-1");
    const { seq } = rollDetails.getState();
    diceDetailsWindowBase.onClose();
    expect(rollDetails.getState()).toEqual({ entryId: null, seq });
  });

  test("FR-SHELL-200 FR-DICEX-03 Dice tray: staged request, result and mode; `staged` stays", () => {
    diceExtras.stage({ kind: "free", expression: "1d6", mode: "advantage", category: "other" });
    const { staged } = diceExtras.api.getState();
    trayWindowBase.onClose();
    const s = diceExtras.api.getState();
    expect(s.request).toBeNull();
    expect(s.result).toBeNull();
    expect(s.mode).toBe("normal");
    expect(s.staged).toBe(staged); // the runtime opens the tray only on a new stage
  });
});
