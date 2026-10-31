// FR-SHARE-01, -02, -05, -07, -08, -11 (client): a share's row in the game log, its menu, and the
// Send to game log button, over a fake sync store (static render).
import { describe, expect, test } from "bun:test";
import type { EntryResponse } from "@shared/compendium/rest";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { FOLDED_TEXT } from "@shared/log-share/kind";
import { LOG_KIND_SHARE, type SharePayload } from "@shared/log-share/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { EntryView } from "../compendium/views";
import { entryMenuItems } from "../dice-roll-log/entry-menu";
import { GameLog } from "../dice-roll-log/GameLog";
import { tallRowTop } from "../dice-roll-log/logic";
import { ShareButton } from "./ShareButton";

const entry = (payload: SharePayload): GameLogEntryView => ({
  id: "s1",
  campaignId: "c1",
  n: 1,
  at: "2026-10-31T10:00:00.000Z",
  kind: LOG_KIND_SHARE,
  category: "other",
  public: true,
  undone: false,
  rollerRole: "player",
  rollerPlayerId: "p1",
  actorName: "Mira",
  payload,
  rollIds: [],
  encounterId: null,
  supersededBy: null,
});

function render(el: ReactElement, entries: GameLogEntryView[] = [], state = "live") {
  const store = {
    ...emptyStore(),
    you: { campaignId: "c1", role: "player", playerId: "p1" },
    records: {
      [GAME_LOG_ENTRY_TYPE]: Object.fromEntries(entries.map((e) => [e.id, e])),
      player: { p1: { id: "p1", name: "Player 1" } },
    },
  } as unknown as RecordStore;
  const sync = createStore<SyncState>()(
    () =>
      ({
        state,
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

const fireball: SharePayload = {
  title: "Fireball",
  line: "Level 3 evocation",
  text: "**Range:** 150 feet\n\nA bright streak flashes.",
};

describe("FR-SHARE-05 a share in the game log", () => {
  test("FR-SHARE-05 the head, the summary and the whole text show on the row, markdown rendered", () => {
    const html = render(<GameLog />, [entry(fireball)]);
    expect(html).toContain("shares Fireball");
    expect(html).toContain('data-testid="share-entry-body"');
    expect(html).toContain("Level 3 evocation");
    expect(html).toContain("A bright streak flashes.");
    expect(html).toMatch(/<strong class="font-semibold">.*Range:.*<\/strong>/);
  });

  test("FR-SHARE-05 the row grows with its text; a roll's stays 40 px", () => {
    const html = render(<GameLog />, [entry(fireball)]);
    const row = html.slice(html.indexOf('data-testid="dice-log-entry"'));
    const cls = /class="([^"]*)"/.exec(row)?.[1] ?? "";
    expect(cls.split(" ")).toContain("min-h-10");
    expect(cls.split(" ")).not.toContain("h-10");
  });

  test("FR-SHARE-08 a folded share shows the note, not an empty row", () => {
    const html = render(<GameLog />, [entry({ ...fireball, text: "", folded: true })]);
    expect(html).toContain('data-testid="share-entry-folded"');
    expect(html).toContain(FOLDED_TEXT);
  });

  test("FR-SHARE-06 a cut text says so", () => {
    const html = render(<GameLog />, [entry({ ...fireball, cut: true })]);
    expect(html).toContain('data-testid="share-entry-cut"');
  });

  test("FR-SHARE-07 the menu: Copy text and the DM's Hide; no Roll details, no tray", () => {
    const base = { live: true, landed: true, actions: [], creature: null };
    const e = entry(fireball);
    expect(entryMenuItems({ ...base, entry: e, isDm: false }).map((i) => i.value)).toEqual([
      "copy",
    ]);
    expect(entryMenuItems({ ...base, entry: e, isDm: true }).map((i) => i.value)).toEqual([
      "copy",
      "hide",
    ]);
  });
});

describe("FR-SHARE-01 FR-SHARE-10 FR-SHARE-11 on a compendium entry", () => {
  const data = (kind: string, shared: boolean, campaignId: string | null, body: unknown) =>
    ({
      entry: {
        id: "e9",
        campaignId,
        kind,
        source: campaignId ? null : "srd-5.1",
        sourceKey: campaignId ? null : `${kind}/x`,
        name: "Thing",
        line: "A line",
        facets: {},
        body,
        definitionId: null,
        shared,
        derivedFromId: null,
        imageAssetIds: [],
        createdAt: "",
        updatedAt: "",
        importedAt: null,
      },
      source: null,
    }) as unknown as EntryResponse;

  test("FR-SHARE-01 a condition has the labelled button, for a player too", () => {
    const html = render(
      <EntryView data={data("condition", false, null, { text: "Words." })} viewer="player" />,
    );
    expect(html).toContain('data-testid="share-send"');
    expect(html).toContain("Send to game log");
  });

  test("FR-SHARE-10 a monster's stat block has none", () => {
    const body = { meta: {}, traits: [], actions: [], bonusActions: [], reactions: [] };
    const html = render(
      <EntryView
        data={{
          ...data("monster", false, null, body),
          entry: {
            ...data("monster", false, null, body).entry,
            facets: { cr: "1", type: "humanoid", size: "small" },
          },
        }}
        viewer="dm"
      />,
    );
    expect(html).toContain('data-testid="cmp-entry"');
    expect(html).not.toContain('data-testid="share-send"');
  });
});

describe("FR-SHARE-12 a tall share lands at its head", () => {
  test("FR-SHARE-12 taller than the list: the row's top; fits: stays pinned", () => {
    expect(tallRowTop(500, 400, 240)).toBe(500);
    expect(tallRowTop(500, 240, 240)).toBeNull();
    expect(tallRowTop(500, 100, 240)).toBeNull();
  });
});

describe("FR-SHARE-01 the Send to game log button", () => {
  test("FR-SHARE-01 labelled on an entry: names the source; disabled while not live", () => {
    const source = { from: "compendium", entryId: "e9" } as const;
    const html = render(<ShareButton source={source} labelled />);
    expect(html).toContain('data-testid="share-send"');
    expect(html).toContain('data-source="compendium"');
    expect(html).toContain('data-record-id="e9"');
    expect(html).toContain("Send to game log");
    expect(html).not.toMatch(/\sdisabled=/);
    expect(render(<ShareButton source={source} labelled />, [], "reconnecting")).toMatch(
      /\sdisabled=/,
    );
  });

  test("FR-SHARE-02 an icon on a sheet row: the list and the row id; its name for screen readers", () => {
    const html = render(
      <ShareButton source={{ from: "sheet", creatureId: "c", list: "spells", rowId: "r7" }} />,
    );
    expect(html).toContain('data-source="spells"');
    expect(html).toContain('data-record-id="r7"');
    expect(html).toContain('aria-label="Send to game log"');
  });
});
