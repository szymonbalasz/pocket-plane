// GM3 gems UI (GEM §7, FR-CHARX-71–73, FR-CAMP-43): static renders over in-code stores (the
// `gems-awarded` counts: Mira Inspiration 2 / Combat 1 / Fortune 1, Brakka Fortune 6) and the
// pure model. Clicks (Spend → confirm, ±, Options): e2e/gems-ui.e2e.ts.
import { describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { CHARACTER_GEMS_TYPE, type CharacterGemsRecord } from "@shared/gems/schemas";
import { applySnapshot, type RecordStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { SheetSlotView } from "../character-sheet/SheetSections";
import { SummaryCard } from "../character-sheet/SummaryCard";
import { sectionsFor } from "../character-sheet/sections";
import { sheetSections } from "../character-sheet/sheet-sections";
import { type AdjustPayload, AWARD_BATCH_MS, createAwardBatch } from "./award-batch";
import { GemBlock, gemCountsSection } from "./GemBlock";
import { PartyLineGems } from "./GemCounts";
import {
  affordable,
  CONFIRM_MS,
  countsOf,
  gemChips,
  gemSectionAvailable,
  MAX_LABEL,
  MAX_TIP,
  maySpend,
  SPEND_CHOICES,
  spendPayload,
} from "./model";

const row = (id: string, c: Partial<CharacterGemsRecord>): CharacterGemsRecord => ({
  id,
  campaignId: "c1",
  characterId: id,
  inspiration: 0,
  fortune: 0,
  combat: 0,
  divine: 0,
  action: 0,
  ...c,
});

type Viewer = "dm" | "p1" | "p2";

/** `viewer`'s store: Mira + Brakka (player-1), Thorn (player-2), a goblin; gems `on` or off. */
function store(viewer: Viewer, on: boolean, locked = false): RecordStore {
  const you =
    viewer === "dm"
      ? { campaignId: "c1", role: "dm", playerId: null }
      : { campaignId: "c1", role: "player", playerId: viewer };
  const ent = (id: string, name: string, owner: string | null, kind = "character") => ({
    id,
    campaignId: "c1",
    kind,
    name,
    ownerPlayerId: owner,
    hpCurrent: 10,
    statBlock: { level: 3, className: "Rogue", hpMax: 10, ac: 14 },
  });
  return applySnapshot({
    type: "snapshot",
    seq: 0,
    you,
    records: {
      campaign: [
        { id: "c1", name: "C", dmColor: "#e69f00", ...(on ? { features: ["gems"] } : {}) },
      ],
      player: [
        { id: "p1", campaignId: "c1", name: "Player 1" },
        { id: "p2", campaignId: "c1", name: "Player 2" },
      ],
      entity: [
        ent("mira", "Mira", "p1"),
        ent("brakka", "Brakka", "p1"),
        ent("thorn", "Thorn", "p2"),
        ent("gob", "Goblin", null, "monster"),
      ],
      "creature-sheet": [{ id: "mira", entityId: "mira", status: "approved", locked }],
      // The server sends no row while gems are off (FR-GEM-02); on: the `gems-awarded` counts.
      ...(on
        ? {
            [CHARACTER_GEMS_TYPE]: [
              row("mira", { inspiration: 2, combat: 1, fortune: 1 }),
              row("brakka", { combat: 2, action: 3, divine: 1, fortune: 6 }),
            ],
          }
        : {}),
    },
  } as never);
}

function render(s: RecordStore, node: ReactNode, state = "live"): string {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state,
        store: s,
        connection: { sendIntent: () => Promise.resolve({}) },
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

const count = (html: string, testId: string) => html.split(`data-testid="${testId}"`).length - 1;
/** The opening tag of the element with `testId` and `data-value`. */
const tag = (html: string, testId: string, value: string) =>
  html.match(
    new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*data-value="${value}"[^>]*>`),
  )?.[0] ?? "";
const attr = (t: string, name: string) => t.match(new RegExp(`${name}="([^"]*)"`))?.[1];

describe("FR-CHARX-71 gem section", () => {
  test("FR-CHARX-71 gem section off / on: off → no gem-block, header DOM identical to without the section; on → after the effect chips; monster → absent", () => {
    const header = (s: RecordStore, id: string, kind: "character" | "monster" = "character") =>
      sectionsFor(sheetSections, {
        slot: "header",
        client: "player",
        kind,
        store: s,
        creatureId: id,
      });
    expect(gemCountsSection).toMatchObject({ id: "gem.counts", slot: "header", order: 60 });
    expect(sheetSections).toContain(gemCountsSection);

    // Off: the section is unavailable; the header renders byte-identical to a registry without it.
    const off = store("p1", false);
    expect(header(off, "mira").map((s) => s.id)).not.toContain("gem.counts");
    const without = sheetSections.filter((s) => s !== gemCountsSection);
    const slot = (sections: typeof sheetSections) =>
      render(
        off,
        <SheetSlotView
          slot="header"
          creatureId="mira"
          client="player"
          kind="character"
          sections={sections}
        />,
      );
    const offHtml = slot(sheetSections);
    expect(offHtml).not.toContain("gem-block");
    expect(offHtml).toBe(slot(without));

    // On: after `cbtx.effects` (order 50) in the header; the block renders.
    const on = store("p1", true);
    const ids = header(on, "mira").map((s) => s.id);
    expect(ids.indexOf("gem.counts")).toBeGreaterThan(ids.indexOf("cbtx.effects"));
    const onHtml = render(
      on,
      <SheetSlotView slot="header" creatureId="mira" client="player" kind="character" />,
    );
    expect(onHtml.indexOf('data-record-id="gem.counts"')).toBeGreaterThan(
      onHtml.indexOf('data-record-id="cbtx.effects"'),
    );
    expect(count(onHtml, "gem-block")).toBe(1);

    // FR-CHARX-74: not on NPC sheets / monsters (kinds `character` only, and `available` checks).
    expect(header(store("dm", true), "gob", "monster").map((s) => s.id)).not.toContain(
      "gem.counts",
    );
    expect(gemSectionAvailable(store("dm", true), "gob")).toBe(false);
  });
});

describe("FR-CHARX-72 owner / DM controls", () => {
  test("FR-CHARX-72 owner / DM controls: five chips in order with counts; owner Spend, no ±; DM ± chips and Spend; locked sheet still enabled; not live → disabled", () => {
    const owner = render(store("p1", true, true), <GemBlock creatureId="mira" client="player" />);
    expect(count(owner, "gem-count")).toBe(5);
    const order = [...owner.matchAll(/data-testid="gem-count"[^>]*data-value="([a-z]+)"/g)].map(
      (m) => m[1],
    );
    expect(order).toEqual(["inspiration", "fortune", "combat", "divine", "action"]);
    expect(attr(tag(owner, "gem-count", "inspiration"), "data-count")).toBe("2");
    expect(attr(tag(owner, "gem-count", "inspiration"), "aria-label")).toBe("Inspiration: 2");
    expect(attr(tag(owner, "gem-count", "divine"), "aria-label")).toBe("Divine Knowledge: 0");
    // Zeros muted.
    expect(attr(tag(owner, "gem-count", "divine"), "class")).toContain("text-muted-foreground");
    expect(attr(tag(owner, "gem-count", "fortune"), "class")).not.toContain(
      "text-muted-foreground",
    );
    // Owner: Spend menu enabled on a locked sheet; chips are not buttons (no ±).
    const menu = owner.match(/<button[^>]*data-testid="gem-spend-menu"[^>]*>/)?.[0] ?? "";
    expect(menu).not.toBe("");
    expect(menu).not.toContain('disabled=""');
    expect(owner).not.toMatch(/<button[^>]*data-testid="gem-count"/);

    // DM: every chip is a Popover trigger (− / +) and the Spend menu is there too.
    const dm = render(store("dm", true), <GemBlock creatureId="mira" client="dm" />);
    expect(count(dm, "gem-spend-menu")).toBe(1);
    const dmChips = [...dm.matchAll(/<button[^>]*data-testid="gem-count"[^>]*>/g)].map((m) => m[0]);
    expect(dmChips).toHaveLength(5);
    for (const c of dmChips) expect(c).toContain('aria-haspopup="dialog"');

    // Another player (no sheet of theirs reaches here, but the block itself): no Spend, no ±.
    const other = render(store("p2", true), <GemBlock creatureId="mira" client="player" />);
    expect(count(other, "gem-count")).toBe(5);
    expect(other).not.toContain("gem-spend-menu");
    expect(maySpend(store("p2", true), "mira")).toBe(false);
    expect(maySpend(store("p1", true), "mira")).toBe(true);
    expect(maySpend(store("dm", true), "thorn")).toBe(true);

    // Not live (FR-CHARX-76): counts stay, controls disabled.
    const down = render(
      store("p1", true),
      <GemBlock creatureId="mira" client="player" />,
      "reconnecting",
    );
    expect(attr(tag(down, "gem-count", "inspiration"), "data-count")).toBe("2");
    expect(down.match(/<button[^>]*data-testid="gem-spend-menu"[^>]*>/)?.[0]).toContain(
      'disabled=""',
    );
  });

  test("FR-GEM-08 max 5 label shown, no over-limit styling at 6", () => {
    const html = render(store("p1", true), <GemBlock creatureId="brakka" client="player" />);
    const label = html.match(/<span[^>]*data-testid="gem-max-label"[^>]*>([^<]*)</);
    expect(label?.[1]).toBe(MAX_LABEL);
    expect(MAX_TIP).toBe("A table rule, not enforced");
    // Fortune 6 is drawn exactly as Action 3 (both non-zero): same classes, the count as is.
    const six = tag(html, "gem-count", "fortune");
    const three = tag(html, "gem-count", "action");
    expect(attr(six, "data-count")).toBe("6");
    expect(attr(six, "class")).toBe(attr(three, "class"));
    for (const bad of ["destructive", "warning", "bloodied", "danger", "over"]) {
      expect(attr(six, "class")).not.toContain(bad);
    }
    expect(html).not.toMatch(/over the|too many|limit/i);
  });

  test("FR-GEM-12 FR-GEM-14 FR-GEM-16 FR-GEM-17 Spend menu choices: payloads, Action costs 1 / 1 / 2, affordability, 4-s confirm", () => {
    expect(SPEND_CHOICES.map((c) => [c.value, c.label, c.cost])).toEqual([
      ["fortune", "Fortune", 1],
      ["divine", "Divine Knowledge", 1],
      ["action:bonus", "Bonus action (1)", 1],
      ["action:reaction", "Reaction (1)", 1],
      ["action:action", "Action (2)", 2],
      ["inspiration", "Inspiration: to recall", 1],
    ]);
    // No Combat gem and no reroll here (GM1 / GM2's log and card actions).
    expect(SPEND_CHOICES.some((c) => c.gem === "combat")).toBe(false);
    const full = SPEND_CHOICES.find((c) => c.value === "action:action");
    const fortune = SPEND_CHOICES.find((c) => c.value === "fortune");
    if (!full || !fortune) throw new Error("missing choice");
    expect(spendPayload("brakka", full)).toEqual({
      characterId: "brakka",
      gem: "action",
      use: "action",
    });
    expect(spendPayload("mira", fortune)).toEqual({ characterId: "mira", gem: "fortune" });
    expect(full.ask).toBe("Spend 2 Action gems?");
    const counts = countsOf(row("x", { action: 1, fortune: 1 }));
    expect(affordable(counts, full)).toBe(false);
    expect(affordable(counts, fortune)).toBe(true);
    expect(CONFIRM_MS).toBe(4000);
    // No row yet = all zero (created on the first award, FR-GEM-06).
    expect(gemChips(countsOf(undefined)).every((c) => c.count === 0 && c.muted)).toBe(true);
  });
});

describe("FR-CHARX-73 summary counts", () => {
  test("FR-CHARX-73 summary counts: another player's view of Mira shows the five counts under the level, no menu; gems off → absent", () => {
    const s = store("p2", true);
    const e = s.records.entity?.mira as never;
    const players = Object.values(s.records.player ?? {}) as never;
    const html = render(s, <SummaryCard e={e} players={players} picker={null} />);
    expect(count(html, "charx-summary-gems")).toBe(1);
    expect(count(html, "gem-summary-count")).toBe(5);
    expect(attr(tag(html, "gem-summary-count", "inspiration"), "data-count")).toBe("2");
    expect(html.indexOf("charx-summary-gems")).toBeGreaterThan(html.indexOf("charx-summary-level"));
    expect(html).not.toContain("gem-spend-menu");
    expect(html).not.toContain("gem-award");

    const off = store("p2", false);
    const offHtml = render(
      off,
      <SummaryCard e={off.records.entity?.mira as never} players={players} picker={null} />,
    );
    expect(offHtml).not.toContain("gem-");
  });
});

describe("FR-CAMP-43 party gem counts", () => {
  test("FR-CAMP-43 party gem counts: the DM's party line tail shows Brakka's five counts, Fortune 6 plainly; off → nothing", () => {
    const html = render(store("dm", true), <PartyLineGems characterId="brakka" />);
    expect(count(html, "camp-player-char-gems")).toBe(1);
    expect(
      attr(
        html.match(/<span[^>]*data-testid="camp-player-char-gems"[^>]*>/)?.[0] ?? "",
        "data-record-id",
      ),
    ).toBe("brakka");
    expect(count(html, "gem-summary-count")).toBe(5);
    const six = tag(html, "gem-summary-count", "fortune");
    expect(attr(six, "data-count")).toBe("6");
    expect(attr(six, "class")).toBe(attr(tag(html, "gem-summary-count", "action"), "class"));
    // BL-138: no "·" before the counts (the line's stats are spaced, K10).
    expect(html.startsWith("<span")).toBe(true);
    expect(html).not.toContain("·");
    expect(render(store("dm", false), <PartyLineGems characterId="brakka" />)).toBe("");
    // The feature key the line reads is the registry's.
    expect(GEMS_FEATURE).toBe("gems");
  });
});

describe("FR-GEM-43 quick awards (award batch)", () => {
  /** Fake timers + a recorded `send` that acks when `ack()` runs. */
  function rig() {
    let now = 0;
    let next = 1;
    const due = new Map<number, { at: number; fn: () => void }>();
    const timers = {
      setTimeout: (fn: () => void, ms: number) => {
        const id = next++;
        due.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimeout: (id: unknown) => void due.delete(id as number),
    };
    const advance = (ms: number) => {
      now += ms;
      for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now) continue;
        due.delete(id);
        t.fn();
      }
    };
    const sent: AdjustPayload[] = [];
    const acks: (() => void)[] = [];
    const batch = createAwardBatch({
      timers,
      send: (_name, payload) => {
        sent.push(payload);
        return new Promise<void>((resolve) => acks.push(resolve));
      },
    });
    const ack = async () => {
      for (const a of acks.splice(0)) a();
      await Promise.resolve();
      await Promise.resolve();
    };
    return { batch, sent, advance, ack };
  }

  test("FR-GEM-43 quick awards make one line: six + within 1.5 s → one {delta: 6}; eleven → 10 at once, then 1; + − → nothing; closing flushes", async () => {
    const t = rig();
    for (let i = 0; i < 6; i++) {
      t.batch.click("brakka", "fortune", 1, 0);
      t.advance(AWARD_BATCH_MS - 100);
    }
    // The count shows the pending sum at once, muted until the ack.
    expect(t.batch.shown("brakka", "fortune", 0)).toEqual({ count: 6, pending: true });
    expect(t.sent).toEqual([]);
    t.advance(100);
    expect(t.sent).toEqual([{ characterId: "brakka", gem: "fortune", delta: 6 }]);
    // The event frame lands before the ack: never counted twice.
    expect(t.batch.shown("brakka", "fortune", 6)).toEqual({ count: 6, pending: true });
    await t.ack();
    expect(t.batch.shown("brakka", "fortune", 6)).toEqual({ count: 6, pending: false });

    // Eleven: the tenth click sends {delta: 10} at once, the eleventh 1.5 s later.
    t.sent.length = 0;
    for (let i = 0; i < 11; i++) t.batch.click("mira", "inspiration", 1, 0);
    expect(t.sent).toEqual([{ characterId: "mira", gem: "inspiration", delta: 10 }]);
    expect(t.batch.shown("mira", "inspiration", 0).count).toBe(11);
    t.advance(AWARD_BATCH_MS);
    expect(t.sent.map((p) => p.delta)).toEqual([10, 1]);
    await t.ack();

    // + then − → net 0, nothing sent; the count back to the stored one.
    t.sent.length = 0;
    t.batch.click("mira", "fortune", 1, 2);
    t.batch.click("mira", "fortune", -1, 2);
    t.advance(AWARD_BATCH_MS);
    expect(t.sent).toEqual([]);
    expect(t.batch.shown("mira", "fortune", 2)).toEqual({ count: 2, pending: false });

    // Closing the popover flushes now; another gem's sum keeps waiting.
    t.batch.click("mira", "combat", 1, 0);
    t.batch.click("mira", "combat", 1, 0);
    t.batch.click("mira", "divine", -1, 3);
    t.batch.flush("mira", "combat");
    expect(t.sent).toEqual([{ characterId: "mira", gem: "combat", delta: 2 }]);
    // Not live: the unsent sum is dropped and the count reverts.
    t.batch.drop();
    expect(t.batch.shown("mira", "divine", 3)).toEqual({ count: 3, pending: false });
    t.advance(AWARD_BATCH_MS);
    expect(t.sent).toHaveLength(1);
    // A reject (or a disconnect) settles the in-flight sum too: the stored count shows.
    await t.ack();
    expect(t.batch.shown("mira", "combat", 0)).toEqual({ count: 0, pending: false });
  });
});
