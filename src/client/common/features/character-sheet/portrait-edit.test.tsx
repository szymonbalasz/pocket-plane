// Sheet portrait (FR-CHARX-15 `portraitAssetId`, DM only): edit mode's Portrait row opens the
// portrait picker and sends `char.edit`; Remove clears it; the player's edit mode has no row.
// Static render over a fake sync store.
import { describe, expect, test } from "bun:test";
import { defaultSheetData } from "@shared/character-sheet/sheet";
import { CharacterStatBlock, type DefinitionRecord } from "@shared/entities/schemas";
import { emptyStore } from "@shared/protocol/store";
import type { ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { AssetPickerDialog } from "../assets-pipeline/AssetPicker";
import { MainTab, PortraitEditor } from "./MainTab";
import { SheetContext, type SheetCtx } from "./sheet-context";

const stats = CharacterStatBlock.parse({
  size: "medium",
  ac: 16,
  hpMax: 12,
  initBonus: 2,
  attacks: [],
  level: 1,
  className: "Fighter",
});

type Opts = { client: "dm" | "player"; portrait?: string | null };

function setup(o: Opts) {
  const creature = {
    id: "mira",
    kind: "character",
    name: "Mira",
    campaignId: "c1",
    ownerPlayerId: "p1",
    portraitAssetId: o.portrait ?? null,
    statBlock: stats,
  } as unknown as DefinitionRecord;
  const sheet = defaultSheetData();
  const ctx = {
    creature,
    stats,
    sheet,
    row: undefined,
    client: o.client,
    npc: false,
    readOnly: false,
    canEdit: true,
    editing: true,
    canCount: true,
    ownerName: "Player 1",
  } as unknown as SheetCtx;
  const sent: { name: string; payload: unknown }[] = [];
  const you = { campaignId: "c1", role: o.client, playerId: o.client === "dm" ? null : "p1" };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you },
        notLiveSince: null,
        everLive: true,
        connection: {
          sendIntent: (name: string, payload: unknown) => {
            sent.push({ name, payload });
            return Promise.resolve({});
          },
        },
      }) as unknown as SyncState,
  );
  const wrap = (node: ReactNode) =>
    renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <SheetContext.Provider value={ctx}>{node}</SheetContext.Provider>
        </TooltipProvider>
      </SyncContext.Provider>,
    );
  return { sent, wrap };
}

/** The editor's element tree, rendered once inside the fake contexts. */
function editorTree(o: Opts) {
  const s = setup(o);
  let tree: ReactNode = null;
  function Capture() {
    tree = PortraitEditor();
    return null;
  }
  s.wrap(<Capture />);
  return { ...s, tree };
}

/** Depth-first through children: the first element matching `hit`. */
function find(node: ReactNode, hit: (e: ReactElement) => boolean): ReactElement | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = find(n, hit);
      if (r) return r;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (hit(node)) return node;
  return find((node.props as { children?: ReactNode }).children, hit);
}

/** The found element's props (fails the test when nothing matched). */
function propsOf<P>(e: ReactElement | null): P {
  expect(e).not.toBeNull();
  return (e as ReactElement).props as P;
}

const byTestId = (id: string) => (e: ReactElement) =>
  (e.props as { "data-testid"?: string })["data-testid"] === id;

describe("sheet portrait (FR-CHARX-15, DM only)", () => {
  test("FR-CHARX-15 DM edit mode shows Portrait Choose…; no Remove without a portrait", () => {
    const html = setup({ client: "dm" }).wrap(<MainTab />);
    expect(html).toMatch(/data-testid="charx-portrait-choose"[^>]*>Choose…</);
    expect(html).not.toContain("charx-portrait-remove");
  });

  test("FR-CHARX-15 with a portrait: Change… and Remove", () => {
    const html = setup({ client: "dm", portrait: "img-1" }).wrap(<MainTab />);
    expect(html).toMatch(/data-testid="charx-portrait-choose"[^>]*>Change…</);
    expect(html).toContain('data-testid="charx-portrait-remove"');
  });

  test("FR-CHARX-15 player edit mode has no portrait control (DM-only field)", () => {
    const html = setup({ client: "player", portrait: "img-1" }).wrap(<MainTab />);
    expect(html).not.toContain("charx-portrait-");
  });

  test("FR-CHARX-15 picking an image sends char.edit portraitAssetId (portrait picker)", () => {
    const { tree, sent } = editorTree({ client: "dm" });
    const props = propsOf<{ context: string; onSelect(id: string): void }>(
      find(tree, (e) => e.type === AssetPickerDialog),
    );
    expect(props.context).toBe("portrait");
    props.onSelect("img-2");
    expect(sent).toEqual([
      { name: "char.edit", payload: { creatureId: "mira", set: { portraitAssetId: "img-2" } } },
    ]);
  });

  test("FR-CHARX-15 Remove sends char.edit portraitAssetId null", () => {
    const { tree, sent } = editorTree({ client: "dm", portrait: "img-1" });
    propsOf<{ onClick(): void }>(find(tree, byTestId("charx-portrait-remove"))).onClick();
    expect(sent).toEqual([
      { name: "char.edit", payload: { creatureId: "mira", set: { portraitAssetId: null } } },
    ]);
  });
});
