// FR-CHARX-58 client (sprint 4, [14]): the Features row shows uses left of max, "−1 / 3 left" in
// `hp.down` below zero with every pip filled and a "−1" Badge (Tooltip "1 use more than the
// maximum — check with your DM"); spending past zero asks first (`overspendAsk`: "Use anyway",
// at −9 only the reset hint). Static render over a fake sync store; the click flow is e2e.
import { describe, expect, test } from "bun:test";
import { defaultSheetData, type FeatureRow } from "@shared/character-sheet/sheet";
import { CharacterStatBlock, type DefinitionRecord } from "@shared/entities/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { FeaturesTab } from "./MoreTabs";
import type { SheetCtx } from "./sheet-context";
import { SheetContext } from "./sheet-context";
import { overspendAsk, overspentTip, usesLeftText } from "./view-model";

const stats = CharacterStatBlock.parse({
  size: "medium",
  ac: 15,
  hpMax: 40,
  initBonus: 1,
  attacks: [],
  abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 14 },
  level: 5,
  className: "Barbarian",
});

function render(used: number, client: "dm" | "player" = "player") {
  const rage: FeatureRow = {
    id: "f-rage",
    name: "Rage",
    source: "Barbarian",
    text: "",
    usesMax: 3,
    used,
    reset: "long",
  };
  const sheet = { ...defaultSheetData(), features: [rage] };
  const creature = {
    id: "brakka",
    kind: "character",
    name: "Brakka",
    campaignId: "c1",
    ownerPlayerId: "p1",
    portraitAssetId: null,
    statBlock: stats,
  } as unknown as DefinitionRecord;
  const ctx = {
    creature,
    stats,
    sheet,
    row: { id: "brakka", entityId: "brakka", campaignId: "c1", ownerPlayerId: "p1", ...sheet },
    client,
    npc: false,
    readOnly: false,
    canEdit: false,
    editing: false,
    canCount: true,
    ownerName: "Player 1",
  } as unknown as SheetCtx;
  const you = { campaignId: "c1", role: client, playerId: client === "dm" ? null : "p1" };
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
          <FeaturesTab />
        </SheetContext.Provider>
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const pips = (html: string) => [
  ...html.matchAll(/<button[^>]*data-testid="charx-feature-use"[^>]*>/g),
];

describe("FR-CHARX-58 negative uses display", () => {
  test("FR-CHARX-58 Features row: '0 / 3 left' at 0; '−1 / 3 left' in hp.down below zero, every pip filled, data-left", () => {
    const zero = render(3);
    expect(zero).toContain("0 / 3 left");
    expect(zero).not.toContain('data-testid="charx-feature-overspent"');
    expect(pips(zero).map((m) => m[0].includes('data-left="0"'))).toEqual([true, true, true]);

    for (const client of ["player", "dm"] as const) {
      const html = render(4, client);
      expect(html).toContain("−1 / 3 left");
      expect(html).toMatch(/data-testid="charx-feature-left"[^>]*data-value="-1"[^>]*text-hp-down/);
      const ps = pips(html);
      expect(ps).toHaveLength(3);
      for (const [p] of ps) {
        expect(p).toContain('data-left="-1"');
        expect(p).toContain("bg-hp-down");
      }
    }
    // Down to −9; Reset still offered.
    const floor = render(12);
    expect(floor).toContain("−9 / 3 left");
    expect(floor).toContain('data-testid="charx-resource-reset"');
    expect(render(1)).toContain("2 / 3 left");
  });

  test("FR-MOD-68 uses shown once: the Features row at −1 / 3 reads one '−1 / 3 left', no '−1' Badge beside it", () => {
    for (const client of ["player", "dm"] as const) {
      const html = render(4, client);
      expect(html).not.toContain('data-testid="charx-feature-overspent"');
      const text = html.replace(/<[^>]+>/g, "");
      expect(text).toContain("−1 / 3 left");
      expect(text.split("−1").length - 1).toBe(1);
    }
  });

  test("FR-CHARX-58 words: uses left, Tooltip, the ask before spending past zero and at the floor", () => {
    expect(usesLeftText(2, 3)).toBe("2 / 3 left");
    expect(usesLeftText(-1, 3)).toBe("−1 / 3 left");
    expect(overspentTip(-1)).toBe("1 use more than the maximum — check with your DM");
    expect(overspentTip(-2)).toBe("2 uses more than the maximum — check with your DM");
    expect(overspendAsk("Rage", 0, 3, "Use")).toEqual({
      text: "No Rage uses left (0 / 3). Use anyway? → −1 / 3",
      confirm: "Use anyway",
    });
    expect(overspendAsk("Rage", 0, 3, "Rage")).toEqual({
      text: "No Rage uses left (0 / 3). Rage anyway? → −1 / 3",
      confirm: "Rage anyway",
    });
    expect(overspendAsk("Rage", -8, 3, "Rage").confirm).toBe("Rage anyway");
    expect(overspendAsk("Rage", -9, 3, "Rage")).toEqual({
      text: "Rage is at −9 / 3 — reset it first",
      confirm: null,
    });
  });
});
