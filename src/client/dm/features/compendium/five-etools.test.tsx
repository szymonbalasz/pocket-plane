// FR-CMPX-17 panel states, FR-CMPX-19 test IDs, the run (one book after another, failures kept
// apart), FR-CMPX-18's footer and badge, FR-CMPX-08's Derive form.
import { describe, expect, test } from "bun:test";
import type { AppType } from "@server/app";
import {
  type BookStatus,
  bookPanelState,
  booksSummary,
  type FiveEtoolsStatus,
  type ImportResponse,
} from "@shared/compendium/import";
import type { Api } from "@ui/api";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { badgeLabel, footerLabel } from "@ui/features/compendium/logic";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { hc } from "hono/client";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { deriveStatBlock, entryOnlyBase, initialDerive } from "./derive-form";
import { BOOKS_CONFIRM, bookLine, FiveEtoolsPanel, RunProgress } from "./FiveEtoolsPanel";
import {
  booksOpenByDefault,
  filterBooks,
  importBooks,
  selectBooks,
  updatableBooks,
} from "./five-etools";

const api = hc<AppType>("http://127.0.0.1:1") as Api;

const book = (abbr: string, name: string, extra: Partial<BookStatus> = {}): BookStatus => ({
  key: `5et-${abbr.toLowerCase()}`,
  name,
  abbr,
  counts: { monster: 450, spell: 0, item: 1 },
  ...extra,
});

const READY: FiveEtoolsStatus = {
  state: "ready",
  release: "1.217.1",
  version: "v2",
  books: [
    book("MM", "Monster Manual", { importedVersion: "v2", importedAt: "2026-10-30T10:00:00.000Z" }),
    book("VGM", "Volo's Guide", { importedVersion: "v1", importedAt: "2026-10-01T10:00:00.000Z" }),
    book("XGE", "Xanathar's Guide"),
  ],
};

const store = createStore<SyncState>()(
  () =>
    ({
      state: "live",
      lazy: {},
      connection: { load: () => null, retryLoad: () => null },
    }) as unknown as SyncState,
);

const render = (status: FiveEtoolsStatus, initialOpen = true) =>
  renderToStaticMarkup(
    <SyncContext.Provider value={store}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <FiveEtoolsPanel api={api} status={status} reload={() => {}} initialOpen={initialOpen} />
      </TooltipProvider>
    </SyncContext.Provider>,
  ).replaceAll("<!-- -->", "");

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("FR-CMPX-17 panel states", () => {
  test("FR-CMPX-17 FR-CMPX-19 not-configured: the hint, no list", () => {
    const html = render({ state: "not-configured", books: [] });
    expect(html).toContain('data-testid="cmpx-panel"');
    expect(html).toMatch(/data-testid="cmpx-status"[^>]*data-state="not-configured"/);
    expect(text(html)).toContain("Set PP_5ETOOLS_DIR in .env to your extracted 5etools folder");
    expect(html).not.toContain("cmpx-book");
    expect(html).not.toContain("cmpx-import");
  });

  test("FR-CMPX-17 FR-CMPX-19 not-found: the hint plus the resolved path, and why", () => {
    const html = render({
      state: "not-found",
      path: "D:/5etools-2014",
      issues: ["data/changelog.json: no last ver"],
      books: [],
    });
    expect(html).toMatch(/data-testid="cmpx-status"[^>]*data-state="not-found"/);
    expect(text(html)).toContain("Set PP_5ETOOLS_DIR");
    expect(text(html)).toContain("D:/5etools-2014");
    expect(text(html)).toContain("data/changelog.json: no last ver");
    expect(html).not.toContain("cmpx-book");
  });

  test("FR-CMPX-17 FR-CMPX-19 ready: version, search, one row per book with its state and badge", () => {
    const html = render(READY);
    expect(html).toMatch(/data-testid="cmpx-status"[^>]*data-state="ready"/);
    expect(text(html)).toContain("5etools 1.217.1");
    for (const id of ["cmpx-book-search", "cmpx-import", "cmpx-update-all"]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    expect(html.match(/data-testid="cmpx-book-check"/g)).toHaveLength(3);
    for (const [key, state] of [
      ["5et-mm", "imported"],
      ["5et-vgm", "outdated"],
      ["5et-xge", "new"],
    ] as const) {
      expect(html).toContain(`data-testid="cmpx-book" data-value="${key}" data-state="${state}"`);
    }
    expect(text(html)).toContain("Imported");
    expect(text(html)).toContain("Update");
  });

  test("FR-CMPX-17 Import selected starts disabled (none checked); Update all enabled with an outdated book", () => {
    const html = render(READY);
    expect(html).toMatch(/<button[^>]*data-testid="cmpx-import"[^>]*disabled/);
    expect(html).not.toMatch(/<button[^>]*data-testid="cmpx-update-all"[^>]*disabled/);
    const current = render({ ...READY, books: READY.books.slice(0, 1) });
    expect(current).toMatch(/<button[^>]*data-testid="cmpx-update-all"[^>]*disabled/);
  });

  test("FR-CMPX-17 FR-CMPX-19 progress: Book i / N", () => {
    const html = renderToStaticMarkup(<RunProgress index={2} total={5} />).replaceAll(
      "<!-- -->",
      "",
    );
    expect(html).toContain('data-testid="cmpx-progress"');
    expect(text(html)).toContain("Book 2 / 5");
  });

  test("FR-CMPX-17 confirm text; the book line: abbr · counts · imported ‹date›", () => {
    expect(BOOKS_CONFIRM).toBe("Players will pause for a few seconds per book");
    expect(bookLine(READY.books[0] as BookStatus)).toBe(
      "MM · 450 monsters · 0 spells · 1 item · imported 30 Oct 2026",
    );
    expect(bookLine(READY.books[2] as BookStatus)).toBe("XGE · 450 monsters · 0 spells · 1 item");
  });

  test("FR-CMPX-03 FR-CMPX-19 book state from the versions; Update all takes the outdated only", () => {
    expect(bookPanelState({}, "v2")).toBe("new");
    expect(bookPanelState({ importedVersion: "v2" }, "v2")).toBe("imported");
    expect(bookPanelState({ importedVersion: "v1" }, "v2")).toBe("outdated");
    expect(updatableBooks(READY).map((b) => b.abbr)).toEqual(["VGM"]);
  });

  test("FR-CMPX-17 Books (N) header: collapsed once any book is imported, the list hidden, status and Update all still there", () => {
    expect(booksOpenByDefault(READY)).toBe(false);
    expect(booksOpenByDefault({ ...READY, books: [book("XGE", "Xanathar's Guide")] })).toBe(true);
    const html = render(READY, false);
    expect(text(html)).toContain("Books (3)");
    expect(text(html)).toContain("5etools 1.217.1");
    expect(html).toContain('data-testid="cmpx-books-toggle"');
    expect(html).toContain('data-testid="cmpx-update-all"');
    for (const id of ["cmpx-book", "cmpx-book-search", "cmpx-select-all", "cmpx-import"]) {
      expect(html).not.toContain(`data-testid="${id}"`);
    }
    // Expanded: the search box, Select all / none.
    const opened = render(READY, true);
    for (const id of ["cmpx-book-search", "cmpx-select-all", "cmpx-select-none", "cmpx-import"]) {
      expect(opened).toContain(`data-testid="${id}"`);
    }
  });

  test("FR-CMPX-17 Select all / Select none act on the filtered list only", () => {
    const shown = filterBooks(READY.books, "guide");
    const all = selectBooks(new Set(["5et-mm"]), shown, true);
    expect([...all].sort()).toEqual(["5et-mm", "5et-vgm", "5et-xge"]);
    expect([...selectBooks(all, shown, false)]).toEqual(["5et-mm"]);
  });

  test("FR-CMPX-17 search: name or abbreviation, any case", () => {
    expect(filterBooks(READY.books, "guide").map((b) => b.abbr)).toEqual(["VGM", "XGE"]);
    expect(filterBooks(READY.books, "mm").map((b) => b.abbr)).toEqual(["MM"]);
    expect(filterBooks(READY.books, "  ")).toHaveLength(3);
  });
});

const COUNTS = (created: number, existing: number): ImportResponse["counts"] => ({
  monster: { created, updated: 0, existing },
  spell: { created: 0, updated: 0, existing: 0 },
  item: { created: 0, updated: 0, existing: 0 },
  condition: { created: 0, updated: 0, existing: 0 },
  feature: { created: 0, updated: 0, existing: 0 },
  rule: { created: 0, updated: 0, existing: 0 },
});
const answer = (source: string, created: number, existing = 0, warnings = 0): ImportResponse => ({
  source,
  version: "v2",
  counts: COUNTS(created, existing),
  warnings: Array.from({ length: warnings }, () => ({
    sourceKey: "monster/x",
    field: "f",
    message: "m",
  })),
});

describe("FR-CMPX-12 FR-CMPX-17 the run", () => {
  test("FR-CMPX-12 one after another, the same run id, progress per book, only the last book says so", async () => {
    const order: string[] = [];
    const lasts: boolean[] = [];
    const steps: number[] = [];
    let inFlight = 0;
    const runs = new Set<string>();
    const r = await importBooks(
      READY.books,
      async (key, run, last) => {
        lasts.push(last);
        inFlight++;
        expect(inFlight).toBe(1);
        runs.add(run);
        order.push(key);
        await Promise.resolve();
        inFlight--;
        return answer(key, 1);
      },
      (i) => steps.push(i),
    );
    expect(order).toEqual(["5et-mm", "5et-vgm", "5et-xge"]);
    expect(steps).toEqual([1, 2, 3]);
    expect(lasts).toEqual([false, false, true]);
    expect(runs.size).toBe(1);
    expect(r.done).toHaveLength(3);
    expect(r.failed).toEqual([]);
  });

  test("FR-CMPX-17 a failed book is kept apart; the others go through (§7)", async () => {
    const boom = new Error("End combat first");
    const r = await importBooks(
      READY.books,
      async (key) => {
        if (key === "5et-vgm") throw boom;
        return answer(key, 1);
      },
      () => {},
    );
    expect(r.done.map((d) => d.source)).toEqual(["5et-mm", "5et-xge"]);
    expect(r.failed).toEqual([{ book: READY.books[1] as BookStatus, error: boom }]);
  });

  test("FR-CMPX-17 Toast totals and warning count; a re-import says 0 changed", () => {
    expect(booksSummary([answer("a", 1000, 0, 2), answer("b", 2, 3, 1)])).toBe(
      "2 books: 1,002 new · 0 updated · 3 unchanged · 3 warnings",
    );
    expect(booksSummary([answer("a", 0, 12, 1)])).toBe(
      "1 book: 0 changed · 12 unchanged · 1 warning",
    );
  });
});

describe("FR-CMPX-16 FR-CMPX-18 footer and badge", () => {
  test("FR-CMPX-18 footer: '‹Book› (‹abbr›)', no licence line; the SRD keeps its own", () => {
    const b = { name: "Monster Manual", licence: "User-supplied (5etools)", abbr: "MM" };
    expect(footerLabel(b, false, "dm")).toBe("Monster Manual (MM)");
    expect(footerLabel({ name: "SRD 5.1", licence: "CC BY 4.0" }, false, "player")).toBe(
      "SRD 5.1 · CC BY 4.0",
    );
  });

  test("FR-CMPX-16 badge: the abbreviation as is; a Creatures row's source key → its abbreviation", () => {
    expect(badgeLabel("XGE")).toBe("XGE");
    expect(badgeLabel("5et-mm")).toBe("MM");
    expect(badgeLabel("SRD 5.1")).toBe("SRD");
    expect(badgeLabel("Homebrew")).toBe("Homebrew");
  });
});

describe("FR-CMPX-08 Derive form", () => {
  const facets = { size: "small", type: "fey", cr: "1" } as const;

  test("FR-CMPX-08 entry-only base: the entry's size, type and CR; HP and AC left empty are refused", () => {
    const base = entryOnlyBase(facets);
    const f = { ...initialDerive("Fénwisp", base), ac: "", hpMax: "" };
    expect(f).toMatchObject({ name: "Fénwisp", size: "small", cr: "1", ac: "", hpMax: "" });
    expect(deriveStatBlock(f, base)).toEqual({ ok: false, message: "AC: Required" });
    expect(deriveStatBlock({ ...f, ac: "12" }, base)).toEqual({
      ok: false,
      message: "HP max: Required",
    });
    const r = deriveStatBlock({ ...f, ac: "12", hpMax: "9" }, base);
    expect(r.ok && r.value).toMatchObject({ ac: 12, hpMax: 9, size: "small", type: "fey" });
  });

  test("FR-CMPX-08 a facet type outside the creature types is dropped, not refused", () => {
    expect(entryOnlyBase({ ...facets, type: "swarm" }).statBlock.type).toBeUndefined();
  });
});
