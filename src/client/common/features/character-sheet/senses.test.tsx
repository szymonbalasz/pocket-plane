// Senses on the sheet (CHARX §13 unit, sprint 3): the line's parts and "Senses —" (FR-CHARX-50),
// edit inputs + Switches, NPC sheet, no roll button; Sees invisible part and its owner-disabled
// Switch (FR-CHARX-53). Static server render over a fake sync store.
import { describe, expect, test } from "bun:test";
import { defaultSheetData } from "@shared/character-sheet/sheet";
import {
  CharacterStatBlock,
  type DefinitionRecord,
  MonsterStatBlock,
  type Senses,
} from "@shared/entities/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { DARKNESS_HINT, invisibleHint, SensesLine } from "./Senses";
import type { SheetCtx } from "./sheet-context";
import { SheetContext } from "./sheet-context";
import { NO_SENSES, sensesEdit, sensesParts, sensesText } from "./view-model";

const base = { size: "medium", ac: 15, hpMax: 10, initBonus: 1, attacks: [] };
const DEVIL: Senses = { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true };

function render(
  o: {
    senses?: Senses;
    client?: "dm" | "player";
    npc?: boolean;
    editing?: boolean;
    readOnly?: boolean;
  } = {},
) {
  const client = o.client ?? "player";
  const block = { ...base, ...(o.senses ? { senses: o.senses } : {}) };
  const statBlock = o.npc
    ? MonsterStatBlock.parse({ ...block, cr: "1" })
    : CharacterStatBlock.parse({ ...block, level: 3, className: "Warlock" });
  const creature = {
    id: "thorn",
    kind: o.npc ? "monster" : "character",
    name: "Thorn",
    campaignId: o.readOnly ? null : "c1",
    ownerPlayerId: o.npc ? null : "p2",
    portraitAssetId: null,
    statBlock,
  } as unknown as DefinitionRecord;
  const editing = o.editing ?? false;
  const ctx = {
    creature,
    stats: statBlock,
    sheet: defaultSheetData(),
    row: undefined,
    client,
    npc: o.npc ?? false,
    readOnly: o.readOnly ?? false,
    canEdit: editing,
    editing,
    canCount: true,
    ownerName: "Player 2",
  } as unknown as SheetCtx;
  const you = { campaignId: "c1", role: client, playerId: client === "dm" ? null : "p2" };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you },
        notLiveSince: null,
        everLive: true,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <SheetContext.Provider value={ctx}>
          <SensesLine />
        </SheetContext.Provider>
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, "");
/** The `<button>` / `<input>` tag carrying `testId` (+ `data-value`). */
function tag(html: string, testId: string, value?: string): string {
  const sel = `data-testid="${testId}"${value ? ` data-value="${value}"` : ""}`;
  const m = html.match(new RegExp(`<(button|input)[^>]*${sel}[^>]*>`));
  if (!m) throw new Error(`no ${sel}`);
  return m[0];
}

describe("FR-CHARX-50 senses line", () => {
  test("FR-CHARX-50 senses line: parts omitted at 0 / false, all default → 'Senses —'", () => {
    expect(sensesParts(undefined)).toEqual([]);
    expect(sensesText(undefined)).toBe("—");
    expect(sensesText(NO_SENSES)).toBe("—");
    expect(sensesText({ visionFt: 30, darkvisionFt: 0, seesMagicalDarkness: false })).toBe(
      "Vision 30 ft",
    );
    expect(sensesText({ ...DEVIL, visionFt: 30, seesInvisible: true })).toBe(
      "Vision 30 ft · Darkvision 60 ft · Sees through magical darkness · Sees invisible",
    );
    expect(text(render())).toBe("Senses —");
    expect(text(render({ senses: DEVIL }))).toBe(
      "Senses Darkvision 60 ft · Sees through magical darkness",
    );
  });

  test("FR-CHARX-50 view mode: display only, no inputs, no roll button; NPC and imported sheets show the line too", () => {
    for (const o of [
      {},
      { npc: true, client: "dm" as const },
      { readOnly: true, client: "dm" as const },
    ]) {
      const html = render({ senses: DEVIL, ...o });
      expect(html).toContain('data-testid="charx-senses"');
      expect(html).not.toContain("<button");
      expect(html).not.toContain("<input");
      expect(html).not.toContain("charx-roll");
    }
  });

  test("FR-CHARX-50 edit mode: two number inputs (step 5, 0–120) + Switch with its Tooltip; NPC sheet the same for the DM", () => {
    for (const o of [{ client: "player" as const }, { client: "dm" as const, npc: true }]) {
      const html = render({ senses: DEVIL, editing: true, ...o });
      const vision = tag(html, "charx-field", "senses.visionFt");
      const dark = tag(html, "charx-field", "senses.darkvisionFt");
      for (const t of [vision, dark]) {
        expect(t).toContain('type="number"');
        expect(t).toContain('step="5"');
      }
      expect(vision).toContain('value="0"');
      expect(dark).toContain('value="60"');
      const sw = tag(html, "charx-senses-darkness");
      expect(sw).toContain('data-state="checked"');
      expect(sw).not.toContain('disabled=""');
      expect(html).toContain("Sees through magical darkness");
      expect(html).not.toContain("charx-roll");
    }
  });

  test("FR-CHARX-50 edit payload: the whole object; a player never sends seesInvisible, the DM always does", () => {
    expect(sensesEdit(undefined, { darkvisionFt: 30 }, "player")).toEqual({
      visionFt: 0,
      darkvisionFt: 30,
      seesMagicalDarkness: false,
    });
    expect(sensesEdit({ ...DEVIL, seesInvisible: true }, { darkvisionFt: 30 }, "player")).toEqual({
      ...DEVIL,
      darkvisionFt: 30,
    });
    expect(sensesEdit(DEVIL, { seesInvisible: true }, "dm")).toEqual({
      ...DEVIL,
      seesInvisible: true,
    });
    expect(sensesEdit(DEVIL, { seesMagicalDarkness: false }, "dm")).toEqual({
      ...DEVIL,
      seesMagicalDarkness: false,
      seesInvisible: false,
    });
  });
});

describe("FR-CHARX-53 Sees invisible on the sheet", () => {
  test("FR-CHARX-53 Sees invisible: part on the line; Switch disabled for the owner ('Only the DM sets this'), enabled for the DM; absent key = off", () => {
    const on = { ...DEVIL, seesInvisible: true };
    expect(text(render({ senses: on }))).toContain("· Sees invisible");
    const owner = tag(render({ senses: on, editing: true }), "charx-senses-invisible");
    expect(owner).toContain(' disabled=""');
    expect(owner).toContain('data-disabled=""');
    expect(owner).toContain('data-state="checked"');
    const dm = tag(
      render({ senses: DEVIL, editing: true, client: "dm" }),
      "charx-senses-invisible",
    );
    expect(dm).not.toContain('disabled=""');
    expect(dm).toContain('data-state="unchecked"');
    // Tooltips (content renders on hover).
    expect(invisibleHint("player")).toBe("Only the DM sets this");
    expect(invisibleHint("dm")).toBe("Truesight, See Invisibility and similar");
    expect(DARKNESS_HINT).toBe("Devil's Sight and similar: see normally in magical darkness");
  });
});
