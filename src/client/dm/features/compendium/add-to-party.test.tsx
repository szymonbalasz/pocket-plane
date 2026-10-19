// FR-CMP-40–42 DM client: Add to party only on item entry views (not other kinds, not in the
// player client), the `party.addItem` payload (name clipped as Add to sheet), the Popover states
// (qty rules, not live, in flight, reject keeps qty, lost intent → toast) and the unshared
// homebrew hint. Merge, caps, log row and `loot-received`: fixtures/bundles/party-cmp.fixtures.test.ts.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clip } from "@shared/compendium/homebrew";
import type { EntryResponse } from "@shared/compendium/rest";
import type { CompendiumEntry } from "@shared/compendium/schemas";
import { PARTY_FULL_MESSAGE } from "@shared/party-board/schemas";
import { emptyStore } from "@shared/protocol/store";
import type { Api } from "@ui/api";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { LOST_ITEM_ADD } from "@ui/features/party-board/inventory-logic";
import { intentFailure } from "@ui/features/party-board/logic";
import { IntentRejected } from "@ui/sync/connection";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { AddToPartyPanel } from "./AddToParty";
import {
  addToPartyHint,
  addToPartyPayload,
  CLOSED,
  hasAddToParty,
  partyItemName,
  settle,
} from "./add-to-party";
import { EntryActions } from "./EntryActions";

const ROW = {
  derivedFromId: null,
  imageAssetIds: [],
  createdAt: "t",
  updatedAt: "t",
  definitionId: null,
  importedAt: null,
};
const POTION: CompendiumEntry = {
  ...ROW,
  id: "e-potion",
  campaignId: null,
  kind: "item",
  source: "srd-5.1",
  sourceKey: "item/potion-of-healing",
  name: "Potion of Healing",
  line: "Common potion",
  facets: { category: "magic", rarity: "common", attunement: false },
  body: { typeLine: "Potion", weight: "", text: "You regain 2d4 + 2 hit points." },
  shared: false,
  importedAt: "t",
};
const SHARD: CompendiumEntry = {
  ...POTION,
  id: "e-shard",
  campaignId: "c1",
  source: null,
  sourceKey: null,
  name: "Moonblade Shard",
  shared: false,
  importedAt: null,
};
/** Same entry, another kind (only `kind` matters to the actions row). */
const asKind = (e: CompendiumEntry, kind: CompendiumEntry["kind"]) =>
  ({ ...e, kind }) as CompendiumEntry;

function store(state: "live" | "reconnecting") {
  return createStore<SyncState>()(
    () =>
      ({
        state,
        store: { ...emptyStore(), you: { campaignId: "c1", role: "dm", playerId: null } },
        lazy: {},
        connection: {},
      }) as unknown as SyncState,
  );
}

function render(data: EntryResponse, state: "live" | "reconnecting" = "live") {
  return renderToStaticMarkup(
    <SyncContext.Provider value={store(state)}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <EntryActions api={{} as Api} data={data} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const panel = (
  entry: CompendiumEntry,
  o: { qty?: string; live?: boolean; busy?: boolean; error?: string | null } = {},
) =>
  renderToStaticMarkup(
    <AddToPartyPanel
      entry={entry}
      qty={o.qty ?? "1"}
      error={o.error ?? null}
      live={o.live ?? true}
      busy={o.busy ?? false}
      onQty={() => {}}
      onSubmit={() => {}}
    />,
  );

/** The opening tag of the element with `testId`. */
const tag = (html: string, testId: string) =>
  new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? "";
const disabled = (html: string, testId: string) => / disabled=""/.test(tag(html, testId));

describe("CMP §7 Add to party (FR-CMP-40–42)", () => {
  test("FR-CMP-40 Add to party only on item views", () => {
    for (const e of [POTION, SHARD]) {
      expect(hasAddToParty(e)).toBe(true);
      expect(render({ entry: e, source: null })).toContain('data-testid="cmp-add-to-party"');
    }
    for (const kind of ["spell", "feature", "condition", "monster"] as const) {
      expect(hasAddToParty({ kind })).toBe(false);
      for (const e of [POTION, SHARD]) {
        expect(render({ entry: asKind(e, kind), source: null })).not.toContain("cmp-add-to-party");
      }
    }
    // A monster with a definition shows Derive… only.
    const goblin = render({
      entry: { ...asKind(POTION, "monster"), definitionId: "d-gob" },
      source: null,
      definition: { id: "d-gob", name: "Goblin", statBlock: {} as never },
    });
    expect(goblin).toContain("cmp-derive");
    expect(goblin).not.toContain("cmp-add-to-party");
    // Not live → the button is disabled (shell offline rule).
    expect(
      disabled(render({ entry: POTION, source: null }, "reconnecting"), "cmp-add-to-party"),
    ).toBe(true);
    expect(disabled(render({ entry: POTION, source: null }), "cmp-add-to-party")).toBe(false);
  });

  test("FR-CMP-42 not in the player client: the player compendium mounts no entry actions", () => {
    const dir = join(import.meta.dir, "../../../player/features/compendium");
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect([f, /entryActions|AddToParty|cmp-add-to-party/.test(src)]).toEqual([f, false]);
    }
  });

  test("FR-CMP-40 name clip: payload {name, qty, notes: ''}; 81-char name → 59 + '…' (Add to sheet's clip)", () => {
    expect(addToPartyPayload("Potion of Healing", "2")).toEqual({
      ok: true,
      value: { name: "Potion of Healing", qty: 2, notes: "" },
    });
    const long = `${"Ring of ".repeat(10)}X`;
    expect(long).toHaveLength(81);
    const r = addToPartyPayload(long, "1");
    if (!r.ok) throw new Error(r.message);
    expect(r.value.name).toBe(clip(long, 60));
    expect(r.value.name).toBe(`${long.slice(0, 59)}…`);
    expect(r.value.name).toHaveLength(60);
    expect(partyItemName(long)).toBe(r.value.name);
  });

  test("FR-CMP-41 states: qty 0 / 10 000 / 1.5 / empty → Add disabled; not live or in flight → disabled; reject keeps qty; lost intent → toast", () => {
    for (const qty of ["0", "10000", "1.5", "", "-1", "abc"]) {
      expect([qty, addToPartyPayload("Potion", qty).ok]).toEqual([qty, false]);
      expect([qty, disabled(panel(POTION, { qty }), "cmp-add-to-party-submit")]).toEqual([
        qty,
        true,
      ]);
    }
    expect(panel(POTION, { qty: "0" })).toContain('data-testid="cmp-add-to-party-error"');
    expect(panel(POTION, { qty: "" })).not.toContain("cmp-add-to-party-error");
    expect(disabled(panel(POTION, { qty: "9999" }), "cmp-add-to-party-submit")).toBe(false);
    expect(disabled(panel(POTION), "cmp-add-to-party-submit")).toBe(false);
    expect(tag(panel(POTION), "cmp-add-to-party-qty")).toContain('value="1"');
    expect(disabled(panel(POTION, { live: false }), "cmp-add-to-party-submit")).toBe(true);
    expect(disabled(panel(POTION, { busy: true }), "cmp-add-to-party-submit")).toBe(true);

    // ack → closed, qty back to the default; reject → inline, qty kept.
    const open = { open: true, qty: "3", error: null };
    expect(settle(open, { kind: "ack" })).toEqual(CLOSED);
    const full = intentFailure(new IntentRejected("conflict", PARTY_FULL_MESSAGE), LOST_ITEM_ADD);
    expect(full).toEqual({ kind: "inline", message: "Party inventory is full (60)" });
    const rejected = settle(open, full);
    expect(rejected).toEqual({ open: true, qty: "3", error: PARTY_FULL_MESSAGE });
    expect(panel(POTION, { qty: rejected.qty, error: rejected.error })).toContain(
      PARTY_FULL_MESSAGE,
    );
    // Lost to a disconnect → the toast text; the Popover keeps qty, no inline line.
    for (const code of ["disconnected", "offline"]) {
      const lost = intentFailure(new IntentRejected(code, "x"), LOST_ITEM_ADD);
      expect(lost).toEqual({
        kind: "toast",
        message: "Connection lost — check the party inventory before adding again",
      });
      expect(settle(open, lost)).toEqual(open);
    }
  });

  test("FR-CMP-41 unshared homebrew → hint shown; shared homebrew and imported → none", () => {
    expect(addToPartyHint(SHARD)).toBe("Players will see Moonblade Shard in the party inventory");
    expect(panel(SHARD)).toContain('data-testid="cmp-add-to-party-hint"');
    expect(panel(SHARD)).toContain("Players will see Moonblade Shard in the party inventory");
    expect(addToPartyHint({ ...SHARD, shared: true })).toBeNull();
    expect(panel({ ...SHARD, shared: true })).not.toContain("cmp-add-to-party-hint");
    expect(addToPartyHint(POTION)).toBeNull();
    expect(panel(POTION)).not.toContain("cmp-add-to-party-hint");
  });
});
