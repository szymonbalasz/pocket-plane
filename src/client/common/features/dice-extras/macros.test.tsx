// TT1 macros, client (FR-DICEX-68–72, FR-CHARX-87–89): groups per viewer as `dicex-macros`
// loads them, the roll path (a plain `dice.roll`), the editor's checks, states with reasons, the
// tray's Macros button, and the sheet's Macros tab. Static renders over a fake sync store.
import { afterEach, describe, expect, test } from "bun:test";
import type { RollMacroRecord } from "@shared/dice-extras/macros";
import { emptyStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { sectionsFor } from "../character-sheet/sections";
import { sheetSections } from "../character-sheet/sheet-sections";
import { MacroRow } from "./MacroButton";
import { MacroEditor, MacrosPanel } from "./MacrosPanel";
import { dicexMacrosSection } from "./MacrosSection";
import {
  canEditMacro,
  draftError,
  draftOf,
  GONE,
  type MacroViewer,
  macroBlock,
  macroGroups,
  macroRollIntent,
  NOT_LIVE,
  NOT_YOURS,
  saveInput,
  shownError,
  UNTOUCHED,
} from "./macro-logic";
import { diceExtras } from "./store";
import { TrayWindow } from "./TrayWindow";

const creatures = [
  { id: "mira", name: "Mira", kind: "character", ownerPlayerId: "p1" },
  { id: "thorn", name: "Thorn", kind: "character", ownerPlayerId: "p2" },
  { id: "elite", name: "Elite Goblin Warrior", kind: "monster", ownerPlayerId: null },
];
const players = [
  { id: "p1", name: "Player 1" },
  { id: "p2", name: "Player 2" },
];
const row = (id: string, name: string, o: Partial<RollMacroRecord> = {}): RollMacroRecord => ({
  id,
  campaignId: "c1",
  playerId: null,
  creatureId: null,
  name,
  expression: "1d4",
  category: "other",
  order: 0,
  createdBy: null,
  ...o,
});
/** `dicex-macros` (fixtures/units/dice-extras). */
const MACROS = [
  row("m-sneak", "Sneak Attack", {
    playerId: "p1",
    creatureId: "mira",
    expression: "3d6",
    category: "damage",
    createdBy: "p1",
  }),
  row("m-luck", "Luck", { playerId: "p1", expression: "1d100", createdBy: "p1" }),
  row("m-bless", "Bless"),
  row("m-insp", "Inspiration", { playerId: "p2", creatureId: "thorn", expression: "1d8" }),
  row("m-ambush", "Ambush", { creatureId: "elite", expression: "2d6", category: "damage" }),
];
const DM: MacroViewer = { role: "dm", playerId: null };
const P1: MacroViewer = { role: "player", playerId: "p1" };
const P2: MacroViewer = { role: "player", playerId: "p2" };
const visible = (v: MacroViewer) =>
  v.role === "dm" ? MACROS : MACROS.filter((m) => m.playerId === v.playerId);
const titles = (v: MacroViewer, actor: string | null = null) =>
  macroGroups(visible(v), v, creatures, players, actor).map((g) => [
    g.title,
    g.macros.map((m) => m.name),
  ]);

function render(node: ReactNode, v: MacroViewer, o: { live?: boolean; sent?: unknown[] } = {}) {
  const sent = o.sent ?? [];
  const byId = <T extends { id: string }>(list: readonly T[]) =>
    Object.fromEntries(list.map((x) => [x.id, x]));
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: o.live === false ? "connecting" : "live",
        store: {
          ...emptyStore(),
          you: { campaignId: "c1", role: v.role, playerId: v.playerId },
          records: {
            entity: byId(creatures),
            player: byId(players),
            "roll-macro": byId(visible(v)),
          },
        },
        notLiveSince: null,
        everLive: true,
        connection: {
          sendIntent: (name: string, payload: unknown) => {
            sent.push([name, payload]);
            return Promise.resolve({});
          },
        },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}
const ids = (html: string, testId: string) =>
  [...html.matchAll(new RegExp(`data-testid="${testId}" data-record-id="([^"]*)"`, "g"))].map(
    (m) => m[1],
  );

afterEach(() => diceExtras.clear());

describe("TT1 macros (client)", () => {
  test("FR-DICEX-69 tray macros: per viewer, the actor first, then creatures, then General", () => {
    expect(titles(DM)).toEqual([
      ["Elite Goblin Warrior", ["Ambush"]],
      ["Mira", ["Sneak Attack"]],
      ["Thorn", ["Inspiration"]],
      ["General", ["Bless"]],
      ["General · Player 1", ["Luck"]],
    ]);
    expect(titles(DM, "thorn")[0]).toEqual(["Thorn", ["Inspiration"]]);
    expect(titles(P1, "mira")).toEqual([
      ["Mira", ["Sneak Attack"]],
      ["General", ["Luck"]],
    ]);
    expect(titles(P2)).toEqual([["Thorn", ["Inspiration"]]]);
    // A gone creature's macros under "General" (FR-DICEX-72); an empty actor still shows.
    const gone = macroGroups([row("x", "Old", { creatureId: "gone" })], DM, creatures, players);
    expect(gone.map((g) => g.title)).toEqual(["General"]);
    expect(macroGroups([], P1, creatures, players, "mira").map((g) => g.title)).toEqual(["Mira"]);
    // The popover's list: rows with ✎ only where the viewer may edit.
    const html = render(<MacrosPanel actorId="thorn" />, P2);
    expect(ids(html, "dicex-macro")).toEqual(["m-insp"]);
    expect(html).not.toContain('data-testid="dicex-macro-edit"');
    expect(html).toContain('data-testid="dicex-macro-new"');
    const dm = render(<MacrosPanel />, DM);
    expect(ids(dm, "dicex-macro-edit")).toEqual([
      "m-ambush",
      "m-sneak",
      "m-insp",
      "m-bless",
      "m-luck",
    ]);
  });

  test("FR-DICEX-68 macro roll path: a plain dice.roll (label = name, actor, physical, public)", () => {
    const sneak = MACROS[0] as RollMacroRecord;
    expect(macroRollIntent(sneak, { mode: "advantage" })).toEqual({
      expression: "3d6",
      mode: "advantage",
      category: "damage",
      label: "Sneak Attack",
      actor: { entityId: "mira" },
    });
    expect(
      macroRollIntent(MACROS[2] as RollMacroRecord, {
        mode: "normal",
        manual: [{ diceTotal: 3, dice: [3] }],
        public: false,
      }),
    ).toEqual({
      expression: "1d4",
      mode: "normal",
      category: "other",
      label: "Bless",
      manual: { diceTotal: 3, dice: [3] },
      public: false,
    });
    // The row is a RollButton (Alt hint in its tooltip) labelled with the name.
    const html = render(
      <ul>
        <MacroRow m={sneak} viewer={P1} creatures={creatures} onEdit={() => {}} />
      </ul>,
      P1,
    );
    expect(html).toContain('data-testid="dicex-macro-roll"');
    expect(html).toContain(">Sneak Attack<");
    expect(html).toContain('data-creature-id="mira"');
  });

  test("FR-DICEX-72 states: not live, a gone creature, not the viewer's → disabled with the reason", () => {
    const sneak = MACROS[0] as RollMacroRecord;
    expect(macroBlock(sneak, P1, creatures, true)).toBeNull();
    expect(macroBlock(sneak, P1, creatures, false)).toBe(NOT_LIVE);
    expect(macroBlock({ creatureId: "gone" }, DM, creatures, true)).toBe(GONE);
    expect(macroBlock(sneak, P2, creatures, true)).toBe(NOT_YOURS);
    expect(macroBlock({ creatureId: "elite" }, DM, creatures, true)).toBeNull();
    const html = render(
      <ul>
        <MacroRow m={sneak} viewer={P1} creatures={creatures} />
      </ul>,
      P1,
      { live: false },
    );
    expect(html).toMatch(/data-testid="dicex-macro-roll"[^>]*disabled=""/);
    expect(html).toContain(`data-reason="${NOT_LIVE}"`);
  });

  test("FR-DICEX-66 rights on the client: the DM's rows read-only for players", () => {
    expect(canEditMacro(MACROS[3] as RollMacroRecord, P2)).toBe(false);
    expect(canEditMacro(MACROS[0] as RollMacroRecord, P1)).toBe(true);
    expect(canEditMacro(MACROS[0] as RollMacroRecord, DM)).toBe(true);
  });

  test("FR-DICEX-71 macro editor: live check (invalid → Save disabled), DM only on an owned PC, Delete asks", () => {
    expect(draftError({ name: "", expression: "1d4" })).toBe("Name is required");
    expect(draftError({ name: "Bad", expression: "1d4+" })).not.toBeNull();
    expect(draftError({ name: "Ok", expression: "2D6 + 1" })).toBeNull();
    const bad = render(
      <MacroEditor draft={draftOf({ name: "Bad", expression: "3x" })} onDone={() => {}} />,
      DM,
    );
    // FR-DICEX-95: no error text before a field is touched; Save disabled meanwhile.
    expect(bad).not.toContain('data-testid="dicex-macro-error"');
    expect(bad).toMatch(/data-testid="dicex-macro-save"[^>]*disabled=""/);
    // DM on Thorn (owned) → "DM only" offered; on the Elite (monster) → not.
    const insp = draftOf(MACROS[3] as RollMacroRecord);
    const onPc = render(<MacroEditor draft={insp} onDone={() => {}} />, DM);
    expect(onPc).toContain('data-testid="dicex-macro-dm-only"');
    expect(onPc).toContain('data-testid="dicex-macro-delete"');
    expect(onPc).toContain('data-testid="dicex-macro-up"');
    const onMonster = render(
      <MacroEditor draft={draftOf(MACROS[4] as RollMacroRecord)} onDone={() => {}} />,
      DM,
    );
    expect(onMonster).not.toContain('data-testid="dicex-macro-dm-only"');
    expect(saveInput({ ...insp, dmOnly: true }, true)).toEqual({
      id: "m-insp",
      name: "Inspiration",
      expression: "1d8",
      category: "other",
      creatureId: "thorn",
      dmOnly: true,
    });
    expect(saveInput(draftOf({ name: "N", expression: "1d4" }), false)).not.toHaveProperty(
      "dmOnly",
    );
  });

  test("FR-DICEX-95 no error before typing: Save as macro's preset → no 'Name is required', Save disabled; type then clear the name → the error shows", () => {
    // Save as macro: the tray's expression filled in, no name (BL-90).
    const preset = draftOf({ expression: "1d20+2" });
    const html = render(<MacroEditor draft={preset} onDone={() => {}} />, P1);
    expect(html).not.toContain("Name is required");
    expect(html).not.toContain('data-testid="dicex-macro-error"');
    expect(html).toMatch(/data-testid="dicex-macro-save"[^>]*disabled=""/);
    expect(html).not.toMatch(/data-testid="dicex-macro-name"[^>]*aria-invalid="true"/);
    // The editor's rule (changed or blurred = touched).
    expect(shownError(preset, UNTOUCHED)).toBeNull();
    expect(draftError(preset)).toBe("Name is required");
    const typed = { ...preset, name: "Bless" };
    expect(shownError(typed, { ...UNTOUCHED, name: true })).toBeNull();
    const cleared = { ...typed, name: "" };
    expect(shownError(cleared, { ...UNTOUCHED, name: true })).toBe("Name is required");
    // A bad expression shows once that field was touched, or Save was pressed.
    const badExpr = { name: "Bless", expression: "1d4+" };
    expect(shownError(badExpr, { ...UNTOUCHED, name: true })).toBeNull();
    expect(shownError(badExpr, { ...UNTOUCHED, expression: true })).not.toBeNull();
    expect(shownError(draftOf({}), { ...UNTOUCHED, submitted: true })).toBe("Name is required");
  });

  test("FR-DICEX-70 save as macro: the tray header has Macros by the gear; the preset is the tray's draft", () => {
    diceExtras.stage({
      kind: "free",
      expression: "1d20+2",
      mode: "normal",
      category: "attack",
      label: "Quick",
      actor: { entityId: "mira" },
    });
    const html = render(<TrayWindow />, P1);
    const header = html.slice(
      html.indexOf('data-tray-part="header"'),
      html.indexOf("dicex-settings-open"),
    );
    expect(header).toContain('data-testid="dicex-tray-macros"');
    expect(
      draftOf({ name: "Quick", expression: "1d20+2", category: "attack", creatureId: "mira" }),
    ).toEqual({
      name: "Quick",
      expression: "1d20+2",
      category: "attack",
      creatureId: "mira",
      dmOnly: false,
    });
  });

  test("FR-CHARX-87 macros tab: `dicex.macros`, tab Macros, order 90, characters + monsters; DM always, a player on own PCs", () => {
    expect(dicexMacrosSection).toMatchObject({
      id: "dicex.macros",
      slot: "tab",
      title: "Macros",
      order: 90,
      kinds: ["character", "monster"],
    });
    const store = (you: object) => ({
      ...emptyStore(),
      you,
      records: { entity: Object.fromEntries(creatures.map((c) => [c.id, c])) },
    });
    const tabs = (you: object, creatureId: string, kind: "character" | "monster" = "character") =>
      sectionsFor(sheetSections, {
        slot: "tab",
        client: (you as { role: "dm" | "player" }).role,
        kind,
        store: store(you) as never,
        creatureId,
      }).map((s) => s.id);
    const dm = { role: "dm", playerId: null, campaignId: "c1" };
    const p1 = { role: "player", playerId: "p1", campaignId: "c1" };
    expect(tabs(dm, "elite", "monster")).toContain("dicex.macros");
    // Seams S11: the tabs end "… Macros, Trophies" (stats' `order: 100`).
    expect(tabs(p1, "mira").slice(-2)).toEqual(["dicex.macros", "stats.trophies"]);
    expect(tabs(p1, "thorn")).not.toContain("dicex.macros");
  });

  test("FR-CHARX-88 FR-CHARX-89 macros tab contents: this creature's rows with ✎, + Macro, DM only badge; no lock gate", () => {
    const p1 = render(<MacrosPanel only="mira" actorId="mira" />, P1);
    expect(ids(p1, "dicex-macro")).toEqual(["m-sneak"]);
    expect(p1).toContain('data-testid="dicex-macro-edit"');
    expect(p1).toContain(">Macro<");
    const hidden = row("m-secret", "Secret", { creatureId: "mira" });
    const dm = render(<MacrosPanel only="mira" />, { ...DM });
    expect(ids(dm, "dicex-macro")).toEqual(["m-sneak"]);
    const badge = render(
      <ul>
        <MacroRow m={hidden} viewer={DM} creatures={creatures} />
      </ul>,
      DM,
    );
    expect(badge).toContain('data-testid="dicex-macro-dm-only-badge"');
    // FR-CHARX-89: the section's availability never reads the sheet lock.
    expect(dicexMacrosSection.available?.toString()).not.toContain("locked");
  });
});
