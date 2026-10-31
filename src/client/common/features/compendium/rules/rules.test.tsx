// Sprint 9 Rules window (CMP §13.3 DOM / unit): the window body's parts and test IDs
// (FR-CMP-66, -74), opening on a card (FR-CMP-69), the states (FR-CMP-73), the attribution
// (FR-CMP-68), Open in Rules on rule entries (FR-CMP-62), the merged search order, pins storage.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { EntryResponse, EntrySummary } from "@shared/compendium/rest";
import { RULES_CHANGE_NOTE, type RulesIndexResponse } from "@shared/compendium/rules";
import { rulesPinsKey } from "@shared/compendium/rules-pages";
import { emptyStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import type { Api } from "../../../api";
import { ApiError, NETWORK_STATUS } from "../../../api";
import { TooltipProvider } from "../../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../../sync/store";
import { createWindowRegistry } from "../../play-shell/registry";
import { ShellProvider } from "../../play-shell/ShellContext";
import { AboutBody } from "../credits";
import { EntryView } from "../views";
import {
  EMPTY_COPY,
  mergeRuleResults,
  pageOfCard,
  RULES_KIND,
  rulesEmpty,
  rulesError,
} from "./logic";
import { LAND_GAP, landScrollTop, placeTarget, resetRulesNav, rulesNav, setCardOpen } from "./nav";
import { openRules } from "./open";
import { createPins } from "./pins";
import {
  type CardCtx,
  EmptyRules,
  followRuleRef,
  ReadState,
  RuleCard,
  RulesBody,
} from "./RulesWindow";

const SRD = {
  key: "srd-5.1",
  name: "SRD 5.1",
  licence: "CC BY 4.0",
  attribution: "This work includes material taken from the System Reference Document 5.1",
  url: null,
  version: "v",
};

const INDEX: RulesIndexResponse = {
  pages: [
    {
      id: "combat",
      title: "Combat",
      cards: [
        { id: "r-dodge", name: "Dodge", section: "Actions in Combat" },
        { id: "r-cover", name: "Cover", section: "Cover" },
      ],
    },
    {
      id: "conditions",
      title: "Conditions",
      cards: [{ id: "c-prone", name: "Prone", section: "Conditions" }],
    },
    {
      id: "house",
      title: "House rules",
      cards: [{ id: "h-flank", name: "Flanking", section: "Combat" }],
    },
  ],
  attribution: SRD,
};

function wrap(node: ReactNode, role: "dm" | "player" = "player") {
  const you = { campaignId: "camp", role, playerId: role === "dm" ? null : "p1" };
  const s = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you },
        lazy: {},
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={s}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <ShellProvider registry={createWindowRegistry(role, [])}>{node}</ShellProvider>
      </TooltipProvider>
    </SyncContext.Provider>,
  ).replaceAll("<!-- -->", "");
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ");
const NO_API = {} as Api;
const ctx = (over: Partial<CardCtx> = {}): CardCtx => ({
  viewer: "player",
  campaignId: "camp",
  pins: [],
  where: "combat",
  ...over,
});

// ShellProvider (Open in Rules' window opener) reads the viewport and the page title.
const g = globalThis as { window?: unknown; document?: unknown };
beforeAll(() => {
  g.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
  };
  g.document = { title: "", hidden: false };
});
afterAll(() => {
  delete g.window;
  delete g.document;
});
afterEach(() => resetRulesNav());

describe("FR-CMP-66 FR-CMP-74 window body", () => {
  test("FR-CMP-66 FR-CMP-74 test IDs: window, page tabs (8, data-value ids), search, footer About; card with data-record-id / data-state and its pin", () => {
    const html = wrap(<RulesBody api={NO_API} viewer="player" />);
    expect(html).toContain('data-testid="cmp-rules-window"');
    const tabs = [...html.matchAll(/data-testid="cmp-rules-page" data-value="([a-z]+)"/g)].map(
      (m) => m[1],
    );
    expect(tabs).toEqual([
      "combat",
      "conditions",
      "checks",
      "exploration",
      "spellcasting",
      "hazards",
      "house",
      "pinned",
    ]);
    expect(html).toContain('data-testid="cmp-rules-search"');
    expect(html).toContain('data-testid="cmp-rules-about"');
    const card = {
      id: "r-cover",
      name: "Cover",
      section: "Cover",
      text: "Half cover.",
      house: false,
      shared: true,
    };
    const closed = wrap(<RuleCard card={card} ctx={ctx()} />);
    expect(closed).toContain('data-testid="cmp-rules-card"');
    // Full text: a long rule name and its section wrap, never cut.
    expect(closed).not.toContain("truncate");
    expect(closed).toContain("min-w-0 break-words text-sm font-medium");
    expect(closed).toContain('data-record-id="r-cover"');
    expect(closed).toContain('data-state="closed"');
    expect(closed).toMatch(/data-testid="cmp-rules-pin" data-record-id="r-cover" data-state="off"/);
    expect(text(closed)).not.toContain("Half cover.");
    setCardOpen("combat", "r-cover", true);
    const open = wrap(<RuleCard card={card} ctx={ctx({ pins: ["r-cover"] })} />);
    expect(open).toContain('data-state="open"');
    expect(open).toMatch(/data-testid="cmp-rules-pin" data-record-id="r-cover" data-state="on"/);
    expect(text(open)).toContain("Half cover.");
    expect(text(open)).toContain("SRD 5.1");
  });

  test("FR-CMP-67 house cards: 'House rule' badge; 'DM only' for the DM's unshared ones only", () => {
    const secret = {
      id: "h-1",
      name: "Critical fumbles",
      section: "Combat",
      text: "t",
      house: true,
      shared: false,
    };
    setCardOpen("house", "h-1", true);
    const dm = text(
      wrap(<RuleCard card={secret} ctx={ctx({ viewer: "dm", where: "house" })} />, "dm"),
    );
    expect(dm).toContain("House rule");
    expect(dm).toContain("DM only");
    const shared = { ...secret, shared: true };
    const p = text(wrap(<RuleCard card={shared} ctx={ctx({ where: "house" })} />));
    expect(p).toContain("House rule");
    expect(p).not.toContain("DM only");
  });
});

describe("FR-CMP-69 open on a card", () => {
  test("FR-CMP-66 open on a card: openRules opens cmp.rules as a user open and targets the card; a card on a page → that page, open, scrolled to; on no page → alone (search view)", () => {
    const calls: unknown[] = [];
    openRules((kind, instance, opts) => calls.push([kind, instance, opts]), "c-prone");
    expect(calls).toEqual([[RULES_KIND, undefined, { by: "user" }]]);
    expect(rulesNav.getState().target).toBe("c-prone");
    expect(pageOfCard(INDEX, "c-prone")).toBe("conditions");
    placeTarget("c-prone", pageOfCard(INDEX, "c-prone"));
    expect(rulesNav.getState()).toMatchObject({
      page: "conditions",
      target: null,
      single: null,
      scrollTo: "c-prone",
      open: { conditions: ["c-prone"] },
    });
    // Between Adventures: on no page → shown alone, open.
    openRules(() => {}, "r-downtime");
    expect(pageOfCard(INDEX, "r-downtime")).toBeNull();
    placeTarget("r-downtime", null);
    expect(rulesNav.getState()).toMatchObject({
      single: "r-downtime",
      open: { card: ["r-downtime"] },
    });
    // No id: the window opens on its page as it was.
    calls.length = 0;
    openRules((kind, instance, opts) => calls.push([kind, instance, opts]));
    expect(calls).toEqual([[RULES_KIND, undefined, { by: "user" }]]);
  });

  test("FR-CMP-62 Open in Rules (cmp-rule-open) on a rule entry view only", () => {
    const base: EntryResponse["entry"] = {
      id: "r-cover",
      campaignId: null,
      kind: "rule",
      source: "srd-5.1",
      sourceKey: "rule/cover/cover",
      name: "Cover",
      line: "Cover · Combat",
      facets: { chapter: "Combat", section: "Cover", order: 0 },
      body: { text: "Walls, trees, creatures." },
      definitionId: null,
      shared: false,
      derivedFromId: null,
      imageAssetIds: [],
      createdAt: "t",
      updatedAt: "t",
      importedAt: "t",
    };
    const rule = wrap(<EntryView data={{ entry: base, source: SRD }} viewer="player" />);
    expect(rule).toContain('data-testid="cmp-rule-open"');
    expect(text(rule)).toContain("Walls, trees, creatures.");
    const cond = {
      ...base,
      kind: "condition" as const,
      sourceKey: "condition/prone",
      facets: {},
      line: "Condition",
    };
    expect(wrap(<EntryView data={{ entry: cond, source: SRD }} viewer="player" />)).not.toContain(
      "cmp-rule-open",
    );
  });
});

describe("FR-CMP-73 states", () => {
  test("FR-CMP-73 states: skeleton while loading; Offline; 'Couldn't load rules' + Retry; nothing imported → the DM / player copy (DM: Open Compendium)", () => {
    const body = (read: Parameters<typeof ReadState<string>>[0]["read"]) =>
      wrap(<ReadState read={read}>{(d) => <p>{d}</p>}</ReadState>);
    expect(body({ state: "loading" })).toContain('data-testid="cmp-rules-loading"');
    const offline = body({ state: "offline", retry: () => {} });
    expect(offline).toContain('data-value="offline"');
    expect(text(offline)).toContain("Offline");
    const error = body({ state: "error", retry: () => {} });
    expect(text(error)).toContain("Couldn't load rules");
    expect(error).toContain('data-testid="cmp-rules-retry"');
    expect(text(body({ state: "ready", data: "Cards" }))).toContain("Cards");
    expect(rulesError(new ApiError(NETWORK_STATUS, { code: "internal", message: "x" }))).toBe(
      "offline",
    );
    expect(rulesError(new ApiError(500, { code: "internal", message: "x" }))).toBe("error");
    const dm = wrap(<EmptyRules viewer="dm" onOpenCompendium={() => {}} />, "dm");
    expect(text(dm)).toContain("Import SRD 5.1 in the Compendium to fill the rules");
    expect(text(dm)).toContain("Open Compendium");
    const p = wrap(<EmptyRules viewer="player" />);
    expect(text(p)).toContain(EMPTY_COPY.player);
    expect(text(p)).not.toContain("Open Compendium");
    expect(rulesEmpty(INDEX)).toBe(false);
    expect(
      rulesEmpty({
        attribution: null,
        pages: INDEX.pages.map((x) => ({ ...x, cards: x.id === "house" ? x.cards : [] })),
      }),
    ).toBe(true);
  });
});

describe("FR-CMP-68 attribution", () => {
  test("FR-CMP-68 attribution: footer 'Rules text: SRD 5.1 · CC BY 4.0 · About'; About shows the SRD statement + 'split into cards… wording unchanged'", () => {
    const html = text(wrap(<RulesBody api={NO_API} viewer="dm" />, "dm"));
    expect(html).toContain("Rules text: SRD 5.1 · CC BY 4.0 · About");
    const about = text(renderToStaticMarkup(<AboutBody sources={[SRD]} />));
    expect(about).toContain(SRD.attribution);
    expect(RULES_CHANGE_NOTE).toBe(
      "Rules text from the SRD 5.1, split into cards at its headings and reformatted; wording unchanged.",
    );
    expect(about).toContain(RULES_CHANGE_NOTE);
    // Another imported source (not the bundled SRD) gets no rules line.
    const other = text(renderToStaticMarkup(<AboutBody sources={[{ ...SRD, key: "fixture" }]} />));
    expect(other).not.toContain(RULES_CHANGE_NOTE);
  });
});

describe("FR-CMP-66 search and pins", () => {
  const s = (id: string, name: string, kind: "rule" | "condition" = "rule"): EntrySummary => ({
    id,
    kind,
    name,
    sourceLabel: "SRD 5.1",
    line: kind === "rule" ? "x · Combat" : "Condition",
  });

  test("FR-CMP-66 merged search: name matches (rules and conditions) before text matches, then the server's order; 'prone' → the Prone condition first", () => {
    const rules = [s("r1", "Dropping to 0 Hit Points"), s("r2", "Standing Up From Prone")];
    const conditions = [s("c1", "Prone", "condition")];
    expect(mergeRuleResults("prone", rules, conditions).map((r) => r.id)).toEqual([
      "c1",
      "r2",
      "r1",
    ]);
    expect(
      mergeRuleResults("grapple", [s("g", "Grappling")], [s("c", "Grappled", "condition")]).map(
        (r) => r.id,
      ),
    ).toEqual(["c", "g"]);
  });

  test("FR-CMP-66 pins per browser and campaign: toggle on / off, ≤ 30 (oldest drops), stale ids dropped, storage failure → memory with one warning", () => {
    const data = new Map<string, string>();
    const pins = createPins(() => ({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    }));
    pins.toggle("camp", "a");
    pins.toggle("camp", "b");
    expect(JSON.parse(data.get(rulesPinsKey("camp")) ?? "[]")).toEqual(["a", "b"]);
    pins.toggle("camp", "a");
    expect(pins.get("camp")).toEqual(["b"]);
    expect(pins.get("other")).toEqual([]);
    for (let i = 0; i < 31; i++) pins.toggle("camp", `x${i}`);
    expect(pins.get("camp")).toHaveLength(30);
    expect(pins.get("camp")[0]).toBe("x1");
    pins.drop("camp", ["x1", "x2"]);
    expect(pins.get("camp")).toHaveLength(28);
    const warn = console.warn;
    let warned = 0;
    console.warn = () => {
      warned++;
    };
    try {
      const broken = createPins(() => {
        throw new Error("blocked");
      });
      broken.toggle("camp", "a");
      broken.toggle("camp", "b");
      expect(broken.get("camp")).toEqual(["a", "b"]);
      expect(warned).toBe(1);
    } finally {
      console.warn = warn;
    }
  });
});

describe("FR-SHELL-188 palette parts", () => {
  test("FR-SHELL-186 FR-SHELL-188 Open Rules opens cmp.rules by user; Rules rows (kind=rule only, ≤ 8, house rules marked) open it on that card", async () => {
    const { rulesCommand, ruleHits, rulesProvider } = await import("./palette");
    const calls: unknown[] = [];
    const ctx = { shell: { openWindow: (...a: unknown[]) => void calls.push(a) } };
    type Ctx = Parameters<typeof rulesCommand.run>[0];
    await rulesCommand.run(ctx as unknown as Ctx);
    expect(calls).toEqual([[RULES_KIND, undefined, { by: "user" }]]);
    expect(rulesNav.getState().target).toBeNull();
    expect(rulesCommand.clients).toEqual(["dm", "player"]);
    expect(rulesProvider).toMatchObject({ group: "Rules", clients: ["dm", "player"] });
    const sum = (
      id: string,
      kind: EntrySummary["kind"],
      sourceLabel = "SRD 5.1",
    ): EntrySummary => ({
      id,
      kind,
      name: id,
      sourceLabel,
      line: "Cover · Combat",
    });
    const hits = ruleHits([
      sum("r-cover", "rule"),
      sum("c-prone", "condition"),
      sum("h-flank", "rule", "Homebrew"),
      ...Array.from({ length: 10 }, (_, i) => sum(`r${i}`, "rule")),
    ]);
    expect(hits).toHaveLength(8);
    expect(hits.map((h) => h.id).slice(0, 2)).toEqual(["r-cover", "h-flank"]);
    expect(hits.every((h) => h.group === "Rules")).toBe(true);
    expect(hits[1]?.hint).toBe("Cover · Combat · Homebrew");
    calls.length = 0;
    hits[0]?.run(ctx as unknown as Ctx);
    expect(rulesNav.getState().target).toBe("r-cover");
    expect(calls).toEqual([[RULES_KIND, undefined, { by: "user" }]]);
  });
});

describe("FR-SHELL-183 P4 ranking", () => {
  test("FR-SHELL-188 P4: 'cover' (and 'dodge', 'grapple') → the first row is the Rules card, not the Open Rules command; Enter opens Rules on it; 'rules' still finds the command", async () => {
    const { COMMANDS, PROVIDERS } = await import("../../play-shell/commands");
    const { flatRows, localEntries, rankLocal, withServer } = await import(
      "../../play-shell/palette/rank"
    );
    const { testCtx } = await import("../../play-shell/palette/test-env");
    const { ruleHits, rulesCommand } = await import("./palette");
    const ctx = testCtx({ registryExtra: [RULES_KIND] });
    const entries = localEntries(COMMANDS, PROVIDERS, ctx);
    for (const [q, id, name] of [
      ["cover", "r-cover", "Cover"],
      ["dodge", "r-dodge", "Dodge"],
      ["grapple", "r-grapple", "Grappling"],
    ] as const) {
      const server = ruleHits([
        { id, kind: "rule", name, sourceLabel: "SRD 5.1", line: "x · Combat" },
      ]);
      const rows = flatRows(withServer(rankLocal(entries, q), server, ctx));
      expect({ q, first: rows[0]?.id }).toEqual({ q, first: id });
      expect(rows.some((r) => r.id === rulesCommand.id)).toBe(false);
    }
    const rows = flatRows(
      withServer(
        rankLocal(entries, "cover"),
        ruleHits([
          {
            id: "r-cover",
            kind: "rule",
            name: "Cover",
            sourceLabel: "SRD 5.1",
            line: "Cover · Combat",
          },
        ]),
        ctx,
      ),
    );
    rows[0]?.run();
    expect(rulesNav.getState().target).toBe("r-cover");
    const rules = flatRows(rankLocal(entries, "rules"));
    expect(rules.some((r) => r.id === rulesCommand.id)).toBe(true);
  });
});

describe("Sprint 10 H4 (BL-98, BL-102)", () => {
  test("FR-CMP-69 BL-98 landing puts the card's heading at the scroller's top (4 px gap), clamped to the scroll range", () => {
    // sim-13 e02: Cover's top at y 1729, the scroller's at 120, scrolled 0 → heading on top.
    const scroller = { top: 120, scrollTop: 0, scrollHeight: 4000, clientHeight: 700 };
    expect(landScrollTop(scroller, 1729)).toBe(1729 - 120 - LAND_GAP);
    // e03: already scrolled past the heading (card top above the view) → back up to it.
    expect(landScrollTop({ ...scroller, scrollTop: 900 }, 60)).toBe(900 + 60 - 120 - LAND_GAP);
    // The last card can't rise above the end; the first can't go below 0.
    expect(landScrollTop(scroller, 4000)).toBe(3300);
    expect(landScrollTop(scroller, 122)).toBe(0);
  });

  test("FR-CMP-61 BL-102 an srd: reference opens its card: a condition first, else a rule card with that name; none → a search for its words", async () => {
    const asked: Record<string, string>[] = [];
    const rows: Record<string, EntrySummary[]> = {
      condition: [
        { id: "c-prone", kind: "condition", name: "Prone", sourceLabel: "SRD 5.1", line: "" },
      ],
      rule: [
        {
          id: "r-diff",
          kind: "rule",
          name: "Difficult Terrain",
          sourceLabel: "SRD 5.1",
          line: "Movement · Movement",
        },
      ],
    };
    const api = {
      api: {
        compendium: {
          search: {
            $get: async ({ query }: { query: Record<string, string> }) => {
              asked.push(query);
              const all = rows[query.kind ?? ""] ?? [];
              return Response.json({
                results: all.filter((r) => r.name.toLowerCase().includes(query.q ?? "")),
                nextCursor: null,
              });
            },
          },
        },
      },
    } as unknown as Api;
    await followRuleRef(api, "prone");
    expect(rulesNav.getState().target).toBe("c-prone");
    expect(asked).toEqual([{ q: "prone", kind: "condition" }]);
    await followRuleRef(api, "difficult-terrain");
    expect(rulesNav.getState().target).toBe("r-diff");
    await followRuleRef(api, "exhaustion");
    expect(rulesNav.getState()).toMatchObject({ q: "exhaustion" });
    // Offline: the words in the search.
    await followRuleRef({} as Api, "grappled");
    expect(rulesNav.getState()).toMatchObject({ q: "grappled" });
  });

  test("FR-CMP-61 BL-102 a card's srd: reference is a link in the window (cmp-rules-link), its quote a blockquote", () => {
    resetRulesNav();
    setCardOpen("combat", "r-shove", true);
    const html = wrap(
      <RuleCard
        card={{
          id: "r-shove",
          name: "Shoving a Creature",
          section: "Attacking",
          text: "Knock it srd:prone or push it.\n\n> **Contests in Combat**\n\n> Battle often involves…",
          house: false,
          shared: true,
        }}
        ctx={ctx({ onRef: () => {} })}
      />,
    );
    expect(html).toContain('data-testid="cmp-rules-link" data-value="prone"');
    expect(text(html)).toContain("Knock it prone or push it.");
    expect(html).toContain("<blockquote");
    expect(text(html)).not.toContain("&gt;");
  });
});

describe("Sprint 10 H4 (BL-104)", () => {
  test("FR-CMP-67 BL-104 the DM's unshared house rule is marked 'DM only' while collapsed; shared ones and players' rows are not", () => {
    const secret = {
      id: "h-2",
      name: "SIM13-HOUSE-SECRET Critical fumbles",
      section: "Combat",
      text: "t",
      house: true,
      shared: false,
    };
    const dm = wrap(<RuleCard card={secret} ctx={ctx({ viewer: "dm", where: "house" })} />, "dm");
    expect(dm).toContain('data-state="closed"');
    expect(dm).toContain('data-testid="cmp-rules-dm-only"');
    const shared = wrap(
      <RuleCard card={{ ...secret, shared: true }} ctx={ctx({ viewer: "dm", where: "house" })} />,
      "dm",
    );
    expect(shared).not.toContain("cmp-rules-dm-only");
    const srd = wrap(
      <RuleCard
        card={{ ...secret, house: false, shared: true }}
        ctx={ctx({ viewer: "dm", where: "house" })}
      />,
      "dm",
    );
    expect(srd).not.toContain("cmp-rules-dm-only");
  });
});
