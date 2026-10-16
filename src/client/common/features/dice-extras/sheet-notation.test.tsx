// Sheet notation (D4, DICEX §13 steps 2–3): feature text, spell notes, item notes and notes go
// through `DiceText` in view mode only. Static server render over a fake sync store, as
// `sheet-render.test.tsx`; a click is `notationRequest` over the sheet's `notationContext`.
import { afterEach, describe, expect, test } from "bun:test";
import {
  type CreatureSheetRecord,
  defaultSheetData,
  FeatureRow,
  ItemRow,
  SpellRow,
} from "@shared/character-sheet/sheet";
import { CharacterStatBlock, type DefinitionRecord } from "@shared/entities/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { ActionsTab } from "../character-sheet/ActionsTab";
import { FeaturesTab, InventoryTab, NotesTab } from "../character-sheet/MoreTabs";
import { rollRoutes } from "../character-sheet/roll-routes";
import { ROLL_HINT } from "../character-sheet/rolls";
import type { RollRoute } from "../character-sheet/routing";
import { notationContext, SheetContext, type SheetCtx } from "../character-sheet/sheet-context";
import { STAGE_HINT } from "../dice-roll-log/roll-control";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { actorFor, notationRequest } from "./DiceText";
import { diceExtras } from "./store";
import { trayControlOptions } from "./TrayWindow";

/** `dicex-notation-text` (fixtures/units/dice-extras): Mira's "Notation test" feature. */
const NOTATION_TEXT =
  "Greataxe 1d12 + 5 slashing. Second Wind d10+1. Hit: 7 (2d6 − 1). Adv: 1d20+3. Not dice: 51d6, 1d1, 2d6/2, 4d6x2, abc1d6.";

const stats = CharacterStatBlock.parse({
  size: "medium",
  ac: 16,
  hpMax: 12,
  initBonus: 0,
  attacks: [],
  abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 16, cha: 10 },
  spellcasting: { ability: "wis", slots: { "1": 2 } },
  level: 1,
  className: "Fighter",
});
const creature = {
  id: "mira",
  kind: "character",
  name: "Mira",
  campaignId: "c1",
  ownerPlayerId: "p1",
  portraitAssetId: null,
  statBlock: stats,
} as unknown as DefinitionRecord;
const sheet = {
  ...defaultSheetData(),
  features: [FeatureRow.parse({ id: "f1", name: "Notation test", text: NOTATION_TEXT })],
  spells: [SpellRow.parse({ id: "s1", name: "Bless", level: 1, notes: "Add 1d4 to the roll." })],
  items: [ItemRow.parse({ id: "i1", name: "Potion of Healing", notes: "Drink: 2d4+2 HP." })],
  notes: "Inspiration: 1d6. Plain line.",
};

function render(node: React.ReactNode, o: { editing?: boolean } = {}) {
  const ctx = {
    creature,
    stats,
    sheet,
    row: { id: "mira", entityId: "mira", campaignId: "c1", ...sheet } as CreatureSheetRecord,
    client: "player",
    npc: false,
    readOnly: false,
    canEdit: true,
    editing: o.editing ?? false,
    canCount: true,
    ownerName: "Player 1",
  } as unknown as SheetCtx;
  const you = { campaignId: "c1", role: "player", playerId: "p1" };
  const entities = { mira: { id: "mira", kind: "character", name: "Mira", ownerPlayerId: "p1" } };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you, records: { entity: entities } },
        notLiveSince: null,
        everLive: true,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  // The shell's title marker takes `document` at render; a stub is enough for a static render.
  const g = globalThis as { document?: unknown };
  g.document = { title: "", hidden: false };
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <ShellProvider registry={createWindowRegistry("player", [])}>
            <SheetContext.Provider value={ctx}>{node}</SheetContext.Provider>
          </ShellProvider>
        </TooltipProvider>
      </SyncContext.Provider>,
    );
  } finally {
    delete g.document;
  }
}

const links = (html: string) =>
  [...html.matchAll(/data-testid="dicex-notation" data-value="([^"]+)"[^>]*>([^<]*)</g)].map(
    (m) => [m[1], m[2]],
  );

afterEach(() => {
  diceExtras.clear();
});

describe("FR-DICEX-30 sheet text through DiceText (view mode)", () => {
  test("FR-DICEX-30 feature text: the walkthrough links; the not-dice cases stay plain text", () => {
    const html = render(<FeaturesTab />);
    expect(links(html)).toEqual([
      ["1d12+5", "1d12 + 5"],
      ["1d10+1", "d10+1"],
      ["2d6-1", "2d6 − 1"],
      ["1d20+3", "1d20+3"],
    ]);
    expect(html).toContain("Not dice: 51d6, 1d1, 2d6/2, 4d6x2, abc1d6.");
  });

  test("FR-DICEX-30 spell notes, item notes and notes", () => {
    expect(links(render(<ActionsTab />))).toEqual([["1d4", "1d4"]]);
    expect(links(render(<InventoryTab />))).toEqual([["2d4+2", "2d4+2"]]);
    const notes = render(<NotesTab />);
    expect(links(notes)).toEqual([["1d6", "1d6"]]);
    expect(notes).toContain("Plain line.");
  });

  test("FR-DICEX-30 edit mode: plain inputs, no notation links", () => {
    for (const tab of [<FeaturesTab key="f" />, <InventoryTab key="i" />, <NotesTab key="n" />]) {
      const html = render(tab, { editing: true });
      expect(html).not.toContain("dicex-notation");
    }
    expect(render(<ActionsTab />, { editing: true })).not.toContain("dicex-notation");
    expect(render(<FeaturesTab />, { editing: true })).toContain(NOTATION_TEXT);
  });

  test("FR-DICEX-29 context = the creature + the row's name: step 3 stages Mira, 'Notation test', other", () => {
    const ctx = notationContext({ creature }, "Notation test");
    const actor = actorFor(ctx.creature, { role: "player", playerId: "p1" }, [creature]);
    expect(notationRequest("1d12+5", ctx, {}, actor)).toEqual({
      kind: "free",
      expression: "1d12+5",
      mode: "normal",
      category: "other",
      label: "Notation test",
      actor: { entityId: "mira" },
    });
    // Another player's view: the default actor (FR-DICE-10).
    expect(actorFor(ctx.creature, { role: "player", playerId: "p2" }, [creature])).toBeUndefined();
    // Label ≤ 60 (a 60-char row name passes as is; longer would be cut).
    const long = notationContext({ creature }, "x".repeat(70));
    expect(notationRequest("1d6", long, {}, undefined).label).toBe("x".repeat(60));
  });

  test("FR-DICEX-29 Shift / Ctrl+click preselect adv / dis for 1d20 expressions only", () => {
    const ctx = notationContext({ creature }, "Notation test");
    expect(notationRequest("1d20+3", ctx, { shiftKey: true }, undefined).mode).toBe("advantage");
    expect(notationRequest("1d20+3", ctx, { ctrlKey: true }, undefined).mode).toBe("disadvantage");
    expect(notationRequest("1d12+5", ctx, { shiftKey: true }, undefined).mode).toBe("normal");
  });

  test("FR-DICEX-31 notation never feeds attack / apply: in combat it still stages `free`, rolled as dice.roll", () => {
    // A combat-like route claiming every sheet roll (first claim wins) changes nothing here.
    const routes = rollRoutes as RollRoute[];
    const claimAll: RollRoute = {
      name: "test-combat",
      claim: () => ({ badge: "In combat", send: () => Promise.resolve() }),
    };
    routes.unshift(claimAll);
    try {
      expect(render(<FeaturesTab />)).toContain('data-value="1d12+5"');
      expect(links(render(<ActionsTab />))).toEqual([["1d4", "1d4"]]);
      const req = notationRequest(
        "1d12+5",
        notationContext({ creature }, "Notation test"),
        {},
        {
          entityId: "mira",
        },
      );
      diceExtras.stage(req);
      expect(diceExtras.api.getState().request?.kind).toBe("free");
      const sent: unknown[] = [];
      const options = trayControlOptions(req, "1d12+5", "normal", (r) => sent.push(r));
      expect(options.category).toBe("other");
      expect(options.subject).toBeUndefined(); // no attack subject, no apply
      options.onRoll({ mode: "normal" });
      expect(sent).toEqual([{ mode: "normal" }]); // the tray's own dice.roll sender
    } finally {
      routes.splice(routes.indexOf(claimAll), 1);
    }
  });
});

describe("FR-DICEX-06 sheet roll buttons", () => {
  test("FR-DICEX-06 the sheet roll tooltip adds 'Alt: adjust in tray'", () => {
    expect(ROLL_HINT).toBe(`Shift: advantage · Ctrl: disadvantage · ${STAGE_HINT}`);
    expect(STAGE_HINT).toBe("Alt: adjust in tray");
  });
});
