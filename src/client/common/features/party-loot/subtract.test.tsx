// LOOT §13 sprint 6 (PF3): the DM add form's Subtract label, hint and disabled rule (FR-LOOT-25–28),
// as pure form state per keystroke and as static renders of the Loot tab and an edited row.
import { describe, expect, test } from "bun:test";
import { LOOT_ENTRY_TYPE, type LootEntryRecord } from "@shared/party-loot/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { addForm, EditRow, LootLog, SUBTRACT_HINT } from "./LootLog";
import { type CoinDraft, EMPTY_DRAFT } from "./logic";

const LIVE = { live: true, busy: false };
const coins = (d: Partial<CoinDraft>): CoinDraft => ({ ...EMPTY_DRAFT, ...d });

const entry = (o: Partial<LootEntryRecord> = {}): LootEntryRecord =>
  ({
    id: "le1",
    campaignId: "c1",
    kind: "loot",
    text: "Rope",
    cp: 0,
    sp: 0,
    ep: 0,
    gp: 0,
    pp: 0,
    createdAt: "2026-10-20T10:00:00.000Z",
    editedAt: null,
    ...o,
  }) as LootEntryRecord;

function render(node: React.ReactNode, records: Record<string, Record<string, unknown>> = {}) {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: {
          ...emptyStore(),
          you: { campaignId: "c1", role: "dm", playerId: null },
          records: { [LOOT_ENTRY_TYPE]: {}, ...records },
        },
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
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

const tagOf = (html: string, testId: string) =>
  new RegExp(`<[a-z0-9]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? "";

describe("loot add form: Subtract (sprint 6)", () => {
  test("FR-LOOT-25 subtract label: gp −5 → Subtract / Subtract from the pot; −2 gp + 15 sp → subtract; 3 gp → Add / Add loot; changes per keystroke", () => {
    const steps = ["", "-", "-5", "-", "", "3"].map((gp) => addForm("", coins({ gp }), LIVE));
    expect(steps.map((s) => s.mode)).toEqual(["add", "add", "subtract", "add", "add", "add"]);
    expect(addForm("", coins({ gp: "-5" }), LIVE)).toMatchObject({
      mode: "subtract",
      title: "Subtract from the pot",
      button: "Subtract",
      enabled: true,
    });
    expect(addForm("", coins({ gp: "-2", sp: "15" }), LIVE).mode).toBe("subtract");
    expect(addForm("Goblin pouch", coins({ gp: "3" }), LIVE)).toMatchObject({
      mode: "add",
      title: "Add loot",
      button: "Add",
      enabled: true,
    });
    // The intent is unchanged: `loot.add` with signed coins.
    const sub = addForm("", coins({ gp: "-5" }), LIVE).parsed;
    expect(sub.ok && sub.value.gp).toBe(-5);
  });

  test("FR-LOOT-26 hint: loot-add-hint under the coin Inputs in add mode, and inside an edited row", () => {
    expect(SUBTRACT_HINT).toBe("Enter a negative amount to subtract.");
    const tab = render(<LootLog />);
    expect(tagOf(tab, "loot-add-title")).toContain('data-mode="add"');
    expect(tab).toContain(">Add loot</h3>");
    expect(tagOf(tab, "loot-add-submit")).toContain('data-mode="add"');
    expect(tagOf(tab, "loot-add-submit")).toContain("disabled");
    expect(tab).toContain(
      `data-testid="loot-add-hint" class="text-xs text-muted-foreground">${SUBTRACT_HINT}`,
    );
    // The hint sits after the coin Inputs.
    expect(tab.indexOf("loot-add-hint")).toBeGreaterThan(tab.lastIndexOf("loot-add-coin"));
    const row = render(<EditRow entry={entry({ gp: -5 })} live onDone={() => {}} />);
    expect(row).toContain('data-record-id="le1"');
    expect(row).toContain(SUBTRACT_HINT);
  });

  test("FR-LOOT-27 disabled: all coins empty, 0, '-', text 'Rope' with no coins → disabled; text + 1 gp → enabled; not live / in flight → disabled", () => {
    expect(addForm("", EMPTY_DRAFT, LIVE).enabled).toBe(false);
    expect(addForm("", coins({ gp: "0" }), LIVE).enabled).toBe(false);
    expect(addForm("", coins({ gp: "-0" }), LIVE)).toMatchObject({ enabled: false, mode: "add" });
    expect(addForm("", coins({ gp: "-" }), LIVE)).toMatchObject({ enabled: false, mode: "add" });
    expect(addForm("Rope", EMPTY_DRAFT, LIVE).enabled).toBe(false);
    expect(addForm("Rope", coins({ gp: "1" }), LIVE).enabled).toBe(true);
    expect(addForm("", coins({ gp: "1" }), { live: false, busy: false }).enabled).toBe(false);
    expect(addForm("", coins({ gp: "1" }), { live: true, busy: true }).enabled).toBe(false);
    expect(addForm("", coins({ gp: "1.5" }), LIVE).enabled).toBe(false); // invalid, as before
  });

  test("FR-LOOT-28 edit form: a text-only row's Save stays enabled after a text change; its button never reads Subtract", () => {
    const save = (html: string) =>
      /<button[^>]*data-testid="loot-edit-save"[^>]*>([^<]*)<\/button>/.exec(html);
    // Unchanged on first render → disabled by FR-LOOT-17; the label is Save even with −5 gp.
    const neg = save(render(<EditRow entry={entry({ gp: -5 })} live onDone={() => {}} />));
    expect(neg?.[1]).toBe("Save");
    expect(neg?.[0]).not.toContain("data-mode");
    // A text-only entry stays editable: its payload is valid with no coin (server rule FR-LOOT-02).
    expect(addForm("Rope, 50 ft", EMPTY_DRAFT, LIVE).parsed.ok).toBe(true);
  });
});
