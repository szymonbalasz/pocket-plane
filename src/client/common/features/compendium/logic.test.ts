// Compendium window logic (FR-CMP-18–22), pure parts.
import { describe, expect, test } from "bun:test";
import {
  entryTotal,
  importSummary,
  type SourceStatus,
  sourcePanelState,
} from "@shared/compendium/import";
import { COMPENDIUM_KINDS } from "@shared/compendium/schemas";
import { ImportCounts } from "@shared/events/compendium";
import {
  activeFilterCount,
  badgeLabel,
  crText,
  emptyText,
  entryForDefinition,
  FILTER_FIELDS,
  footerLabel,
  groupParams,
  isEntryless,
  scoreText,
  searchParams,
  sourceName,
  statBlockRoute,
  tabsFor,
} from "./logic";
import {
  backToList,
  cmpNav,
  openDefinition,
  openEntry,
  resetCmpNav,
  setFilters,
  setQuery,
  setTab,
  toggleGroup,
} from "./nav";

describe("FR-CMP-18 window logic", () => {
  test("FR-CMP-18 kind Tabs: DM All, Monsters, Spells, Items, Conditions, Features; players no Monsters", () => {
    expect(tabsFor("dm")).toEqual(["all", "monster", "spell", "item", "condition", "feature"]);
    expect(tabsFor("player")).toEqual(["all", "spell", "item", "condition", "feature"]);
  });

  test("FR-CMP-18 search params: trimmed q; kind per tab; only that kind's non-empty filters (FR-CMP-11)", () => {
    expect(searchParams("  gob ", "all", { crMin: "1" })).toEqual({ q: "gob" });
    expect(searchParams("", "monster", { crMin: "1/4", crMax: "", level: "3", type: " " })).toEqual(
      { kind: "monster", crMin: "1/4" },
    );
    expect(searchParams("fire", "spell", { level: "3", school: "evocation" })).toEqual({
      q: "fire",
      kind: "spell",
      level: "3",
      school: "evocation",
    });
    expect(activeFilterCount("spell", { level: "3", crMin: "1" })).toBe(1);
    expect(activeFilterCount("all", { level: "3" })).toBe(0);
    // Every Filters field is one of the kind's FR-CMP-11 keys; conditions have none.
    expect(FILTER_FIELDS.condition).toEqual([]);
    for (const k of COMPENDIUM_KINDS) {
      for (const f of FILTER_FIELDS[k])
        expect(searchParams("", k, { [f.key]: "x" })).toHaveProperty(f.key);
    }
  });

  test("FR-CMP-18 FR-CMP-23 nav: a new tab drops filters; entry / definition views; Back refetches the list", () => {
    resetCmpNav();
    setTab("spell");
    setFilters({ level: "3" });
    setTab("spell");
    expect(cmpNav.getState().filters).toEqual({ level: "3" });
    setTab("item");
    expect(cmpNav.getState().filters).toEqual({});
    const n = cmpNav.getState();
    openEntry("e1");
    expect(cmpNav.getState().view).toEqual({ mode: "entry", entryId: "e1" });
    expect(cmpNav.getState().entryNonce).toBe(n.entryNonce + 1);
    backToList();
    expect(cmpNav.getState().view).toEqual({ mode: "list" });
    expect(cmpNav.getState().listNonce).toBe(n.listNonce + 1);
    openDefinition("d1");
    expect(cmpNav.getState().view).toEqual({ mode: "definition", definitionId: "d1" });
    resetCmpNav();
  });
});

describe("FR-CMP-35 FR-CMP-36 group rows (window)", () => {
  test("FR-CMP-35 expand / collapse: a click toggles; opening a member and Back keep it open; a new search, tab or filter collapses all", () => {
    resetCmpNav();
    toggleGroup("asi-barbarian");
    toggleGroup("extra-attack");
    expect(cmpNav.getState().expanded).toEqual(["asi-barbarian", "extra-attack"]);
    toggleGroup("extra-attack");
    expect(cmpNav.getState().expanded).toEqual(["asi-barbarian"]);
    openEntry("asi-fighter");
    backToList();
    expect(cmpNav.getState().view).toEqual({ mode: "list" });
    expect(cmpNav.getState().expanded).toEqual(["asi-barbarian"]);
    // Same search (only spaces differ) keeps it; a new one collapses.
    setQuery(" ");
    expect(cmpNav.getState().expanded).toEqual(["asi-barbarian"]);
    setQuery("ability");
    expect(cmpNav.getState().expanded).toEqual([]);
    toggleGroup("asi-barbarian");
    setTab("feature");
    expect(cmpNav.getState().expanded).toEqual([]);
    toggleGroup("asi-barbarian");
    setFilters({ className: "Fighter" });
    expect(cmpNav.getState().expanded).toEqual([]);
    resetCmpNav();
  });

  test("FR-CMP-35 members query: `sameAs` + the list's trimmed q only (never kind or filters); empty q → all members", () => {
    expect(groupParams("asi-barbarian", "")).toEqual({ sameAs: "asi-barbarian" });
    expect(groupParams("asi-barbarian", "  ability score ")).toEqual({
      sameAs: "asi-barbarian",
      q: "ability score",
    });
  });

  test("FR-CMP-33 FR-CMP-36 empty copy: 'No matches for ‘zzqx’. Every word must match.'; empty q + filters 'No matches'; nothing at all per role", () => {
    expect(emptyText(" zzqx ", false, "dm")).toBe("No matches for ‘zzqx’. Every word must match.");
    expect(emptyText("zzqx", false, "player")).toBe(
      "No matches for ‘zzqx’. Every word must match.",
    );
    expect(emptyText("", false, "dm")).toBe("No matches");
    expect(emptyText("", true, "dm")).toBe("Nothing imported yet");
    expect(emptyText("", true, "player")).toBe("The DM hasn't set up the compendium yet");
  });
});

describe("FR-CMP-19 labels", () => {
  test("FR-CMP-19 footer: 'SRD 5.1 · CC BY 4.0'; homebrew 'Homebrew' (+ Shared / DM only for the DM)", () => {
    const srd = { name: "SRD 5.1", licence: "CC BY 4.0" };
    expect(footerLabel(srd, false, "player")).toBe("SRD 5.1 · CC BY 4.0");
    expect(footerLabel(srd, false, "dm")).toBe("SRD 5.1 · CC BY 4.0");
    expect(footerLabel(null, true, "player")).toBe("Homebrew");
    expect(footerLabel(null, true, "dm")).toBe("Homebrew · Shared");
    expect(footerLabel(null, false, "dm")).toBe("Homebrew · DM only");
  });

  test("FR-CMP-19 source Badge, CR + XP, ability scores", () => {
    expect(badgeLabel("SRD 5.1")).toBe("SRD");
    expect(badgeLabel("Homebrew")).toBe("Homebrew");
    expect(badgeLabel("fixture")).toBe("Fixture");
    expect(sourceName("srd-5.1")).toBe("SRD 5.1");
    expect(crText("1/4")).toBe("1/4 (50 XP)");
    expect(crText("17")).toBe("17 (18,000 XP)");
    expect(scoreText(14)).toBe("14 (+2)");
    expect(scoreText(8)).toBe("8 (−1)");
  });
});

describe("FR-CMP-20 import panel", () => {
  const src = (imported: SourceStatus["imported"]): SourceStatus => ({
    key: "srd-5.1",
    name: "SRD 5.1",
    bundledVersion: "abc",
    imported,
  });
  test("FR-CMP-20 panel state: nothing imported → empty (Import); version differs → Update; same → current", () => {
    expect(sourcePanelState(src(null))).toBe("empty");
    const counts = { monster: 5, spell: 4, item: 0, condition: 0, feature: 0 };
    expect(sourcePanelState(src({ version: "mini", importedAt: "t", counts }))).toBe("update");
    expect(sourcePanelState(src({ version: "abc", importedAt: "t", counts }))).toBe("current");
    expect(entryTotal(counts)).toBe(9);
  });

  test("FR-CMP-20 toast counts", () => {
    const counts = ImportCounts.parse(
      Object.fromEntries(
        COMPENDIUM_KINDS.map((k) => [
          k,
          { created: k === "monster" ? 1_000 : 10, updated: 1, existing: 2 },
        ]),
      ),
    );
    expect(importSummary(counts)).toBe("1,050 new · 6 updated · 12 unchanged"); // 6 kinds (sprint 9: rule)
  });
});

describe("FR-CMP-22 Stat block routing", () => {
  test("FR-CMP-22 custom (campaign) definition → NPC sheet; imported → compendium entry", () => {
    const campaign = new Set(["elite"]);
    expect(statBlockRoute("elite", campaign)).toBe("sheet");
    expect(statBlockRoute("srd-goblin-def", campaign)).toBe("compendium");
  });

  test("FR-CMP-22 the entry linking an imported definition; entryless definitions → stat block only", () => {
    const results = [
      { id: "fixture-gob", definitionId: "fixture-gob" },
      { id: "entry-gob", definitionId: "srd-gob" },
      { id: "entry-hob", definitionId: "srd-hob" },
    ];
    expect(entryForDefinition("srd-gob", results)).toBe("entry-gob");
    expect(entryForDefinition("fixture-gob", results)).toBeNull();
    expect(entryForDefinition("other", results)).toBeNull();
    expect(results.map(isEntryless)).toEqual([true, false, false]);
  });
});
