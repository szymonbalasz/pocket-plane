// RS1 client tests (REM §13 unit, CHARX §13, CBTX FR-CBTX-70, PARTY FR-PARTY-71 / -73): groups per
// viewer, rows, rights, roll-as per surface, the editor's checks, the effects line, the sheet's
// Reminders tab with its count, and the Party Manager tab entry. Static renders over a fake sync
// store (`test-store.tsx`); clicks, the Dialog and the 550-px layout: e2e/rem-ui.e2e.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { CharacterStatBlock, type DefinitionRecord, ENTITY_TYPE } from "@shared/entities/schemas";
import { emptyStore } from "@shared/protocol/store";
import { REMINDER_TYPE, type ReminderView } from "@shared/reminders/schemas";
import { SheetView } from "../character-sheet/SheetView";
import { sectionCount, sectionsFor } from "../character-sheet/sections";
import { sheetSections } from "../character-sheet/sheet-sections";
import { EffectsLine } from "../combat-extras/sheet-sections";
import { PartyBoard } from "../party-board/Board";
import { tabKeyOf } from "../party-board/open-tab";
import { PARTY_TAB_ENTRIES, partyTabs } from "../party-board/party-tabs";
import { partyMemory } from "../party-board/seen";
import {
  canEditReminder,
  draftError,
  draftOf,
  draftUnchanged,
  NOT_LIVE,
  NOT_YOURS,
  PARTY,
  reminderCount,
  reminderGroups,
  reminderRollIntent,
  rollActor,
  rollBlock,
  saveInput,
  targetCharacters,
} from "./logic";
import { RemindersTab } from "./RemindersTab";
import { REMINDERS_TAB, remRemindersSection } from "./section";
import {
  attrs,
  DM,
  ENTITIES,
  P1,
  P2,
  REMINDERS,
  renderWith,
  syncStore,
  tags,
  viewOf,
} from "./test-store";

const LEAKS = ["REM-THORN-OWN", "REM-SECRET-THORN", "REM-SECRET-VAULT", "REM-MIRA-CHARM"];
const leaksIn = (html: string) => LEAKS.filter((s) => html.includes(s));
const rowIds = (rows: readonly ReminderView[]) => rows.map((r) => r.id);

describe("FR-REM-17 groups", () => {
  test("FR-REM-17 groups per viewer: Party first, then characters by name (DM all, a player own ones); rows in creation order; empty groups kept with + Add", () => {
    const dm = reminderGroups(viewOf(REMINDERS, DM), DM, ENTITIES);
    expect(dm.map((g) => [g.key, g.title, rowIds(g.rows), g.canAdd])).toEqual([
      [PARTY, "Party", ["r-bread", "r-steam", "r-vault"], true],
      ["mira", "Mira", ["r-charm"], true],
      ["thorn", "Thorn", ["r-thorn-own", "r-thorn-secret"], true],
    ]);
    const p1 = reminderGroups(viewOf(REMINDERS, P1), P1, ENTITIES);
    expect(p1.map((g) => [g.key, rowIds(g.rows)])).toEqual([
      [PARTY, ["r-bread", "r-steam"]],
      ["mira", ["r-charm"]],
    ]);
    const p2 = reminderGroups(viewOf(REMINDERS, P2), P2, ENTITIES);
    expect(p2.map((g) => [g.key, rowIds(g.rows)])).toEqual([
      [PARTY, ["r-bread", "r-steam"]],
      ["thorn", ["r-thorn-own"]],
    ]);
    // A player with no characters: Party only.
    const p3 = { role: "player" as const, playerId: "p3" };
    expect(reminderGroups([], p3, ENTITIES).map((g) => g.key)).toEqual([PARTY]);
    // Creation order even when the rows arrive shuffled; owner colour from the character.
    const shuffled = [...viewOf(REMINDERS, DM)].reverse();
    expect(rowIds(reminderGroups(shuffled, DM, ENTITIES)[0]?.rows ?? [])).toEqual([
      "r-bread",
      "r-steam",
      "r-vault",
    ]);
    expect(dm[1]?.ownerPlayerId).toBe("p1");
  });

  test("FR-REM-17 FR-REM-16 render per viewer: DM every group, eye-off on hidden rows; player-1 Party + Mira, player-2 Party + Thorn; no other player's or hidden text in the DOM", () => {
    const dm = renderWith(DM, <RemindersTab />);
    expect(attrs(dm, "rem-group", "data-record-id")).toEqual([PARTY, "mira", "thorn"]);
    expect(attrs(dm, "rem-row", "data-dm-only")).toEqual([
      "false",
      "false",
      "true",
      "false",
      "false",
      "true",
    ]);
    expect(dm).toContain(">DM only<");
    expect(dm).toContain(">Hidden with the stronghold<");
    const p1 = renderWith(P1, <RemindersTab />);
    expect(attrs(p1, "rem-group", "data-record-id")).toEqual([PARTY, "mira"]);
    expect(leaksIn(p1)).toEqual(["REM-MIRA-CHARM"]);
    expect(p1).not.toContain(">DM only<");
    const p2 = renderWith(P2, <RemindersTab />);
    expect(attrs(p2, "rem-group", "data-record-id")).toEqual([PARTY, "thorn"]);
    expect(leaksIn(p2)).toEqual(["REM-THORN-OWN"]);
    expect(attrs(p2, "rem-row", "data-dm-only").every((v) => v === "false")).toBe(true);
  });
});

describe("FR-REM-18 rows", () => {
  test("FR-REM-18 row: plain text (no HTML, line breaks kept), source muted, one roll button per roll; link icon only when the caller opens strongholds", () => {
    const dm = renderWith(DM, <RemindersTab />);
    expect(dm).toContain("REM-SECRET-VAULT &lt;b&gt;vault&lt;/b&gt;");
    expect(dm).not.toContain("<b>vault</b>");
    expect(tags(dm, "rem-row-text")[0]).toContain("whitespace-pre-wrap");
    expect(dm).toContain("Fresh bread: +1 HP on a short rest\nAsk the cook");
    expect(dm).toContain("Greystone Keep: Steam Rooms");
    expect(attrs(dm, "rem-row-roll", "data-record-id")).toEqual(["rl-steam", "rl-charm"]);
    // Full text: a long roll label wraps inside its button, never cut.
    expect(tags(dm, "rem-row-roll")[0]).toContain("whitespace-normal");
    expect(dm).not.toContain("truncate");
    expect(dm).not.toContain('data-testid="rem-row-link"');
    const linked = renderWith(DM, <RemindersTab onOpenLink={() => {}} />);
    expect(tags(linked, "rem-row-link")).toHaveLength(1);
  });

  test("FR-REM-08 FR-CHARX-102 client rights: DM menu on every row; player-2 only on the row they created (the DM's are read-only); none while not live", () => {
    const entities = ENTITIES;
    const own = REMINDERS.find((r) => r.id === "r-thorn-own");
    const dmRow = REMINDERS.find((r) => r.id === "r-bread");
    if (!own || !dmRow) throw new Error("fixture");
    expect(canEditReminder(own, P2, entities)).toBe(true);
    expect(canEditReminder(dmRow, P2, entities)).toBe(false);
    expect(canEditReminder(dmRow, DM, entities)).toBe(true);
    // The PC changed owner: the creator loses edit rights; the new owner reads only.
    const moved = entities.map((e) => (e.id === "thorn" ? { ...e, ownerPlayerId: "p1" } : e));
    expect(canEditReminder(own, P2, moved)).toBe(false);
    expect(canEditReminder(own, P1, moved)).toBe(false);
    // A player's party row stays theirs.
    expect(canEditReminder({ createdByPlayerId: "p2", characterId: null }, P2, entities)).toBe(
      true,
    );
    expect(tags(renderWith(DM, <RemindersTab />), "rem-row-menu")).toHaveLength(6);
    const p2 = renderWith(P2, <RemindersTab />);
    const menus = [...p2.matchAll(/data-testid="rem-row" data-record-id="([^"]+)"[\s\S]*?<\/li>/g)]
      .filter((m) => m[0].includes('data-testid="rem-row-menu"'))
      .map((m) => m[1]);
    expect(menus).toEqual(["r-thorn-own"]);
    // Add: Party and own characters only.
    expect(attrs(p2, "rem-group-add", "data-record-id")).toEqual([PARTY, "thorn"]);
    expect(targetCharacters(entities, P2).map((c) => c.id)).toEqual(["thorn"]);
    expect(targetCharacters(entities, DM).map((c) => c.id)).toEqual(["mira", "thorn"]);
    // Not live: last view, every action disabled.
    const off = renderWith(P2, <RemindersTab />, { live: false });
    for (const id of ["rem-row-menu", "rem-group-add"]) {
      expect(tags(off, id).every((t) => t.includes("disabled"))).toBe(true);
    }
    expect(tags(off, "rem-row-roll").every((t) => t.includes(`data-reason="${NOT_LIVE}"`))).toBe(
      true,
    );
  });
});

describe("FR-REM-21 rolls", () => {
  test("FR-REM-21 roll as: a character reminder → that character; a party reminder → no actor in the Party Manager (Me / DM), the sheet's character on a sheet", () => {
    const sheet = { kind: "sheet" as const, characterId: "thorn" };
    expect(rollActor({ characterId: "mira" }, { kind: "party" })).toBe("mira");
    expect(rollActor({ characterId: null }, { kind: "party" })).toBeNull();
    expect(rollActor({ characterId: null }, sheet)).toBe("thorn");
    expect(rollActor({ characterId: "mira" }, sheet)).toBe("mira");
    const charm = { label: "Charm", expression: "1d4", category: "saving-throw" as const };
    expect(reminderRollIntent(charm, "mira", { mode: "advantage" })).toEqual({
      expression: "1d4",
      mode: "advantage",
      category: "saving-throw",
      label: "Charm",
      actor: { entityId: "mira" },
    });
    // Physical dice and the DM's public switch ride along; no actor = "Me" / "DM".
    const manual = { total: 3 } as never;
    expect(
      reminderRollIntent(charm, null, { mode: "normal", manual: [manual], public: true }),
    ).toEqual({
      expression: "1d4",
      mode: "normal",
      category: "saving-throw",
      label: "Charm",
      manual,
      public: true,
    });
    expect(rollBlock("mira", P1, ENTITIES, true)).toBeNull();
    expect(rollBlock("mira", P2, ENTITIES, true)).toBe(NOT_YOURS);
    expect(rollBlock(null, P2, ENTITIES, true)).toBeNull();
    expect(rollBlock("thorn", DM, ENTITIES, true)).toBeNull();
    expect(rollBlock(null, DM, ENTITIES, false)).toBe(NOT_LIVE);
    // Rendered: the Party Manager's Steam roll has no actor; Charm rolls as Mira.
    const p1 = renderWith(P1, <RemindersTab />);
    expect(attrs(p1, "rem-row-roll", "data-actor")).toEqual(["", "mira"]);
  });
});

describe("FR-REM-19 editor", () => {
  test("FR-REM-19 editor locks: Save blocked while invalid (FR-REM-02 mirrored) or unchanged; a player never sends DM fields; the DM does", () => {
    const fresh = draftOf(null, "mira");
    expect(fresh.target).toBe("mira");
    expect(draftError(fresh, P1)).toBe("Text: required");
    expect(draftError({ ...fresh, text: "x".repeat(501) }, P1)).toContain("at most 500");
    expect(draftError({ ...fresh, text: "ok", source: "s".repeat(61) }, P1)).toContain(
      "at most 60",
    );
    const roll = { label: "Charm", expression: "1d4", category: "other" as const };
    expect(draftError({ ...fresh, text: "ok", rolls: [roll] }, P1)).toBeNull();
    expect(
      draftError({ ...fresh, text: "ok", rolls: [{ ...roll, expression: "1q4" }] }, P1),
    ).not.toBeNull();
    expect(draftError({ ...fresh, text: "ok", rolls: [{ ...roll, label: " " }] }, P1)).toBe(
      "Label: required",
    );
    expect(draftError({ ...fresh, text: "ok", rolls: Array(5).fill(roll) }, P1)).toBe(
      "At most 4 rolls",
    );
    // Unchanged: an edit that writes the stored row again; notation compared canonical.
    const row = viewOf(REMINDERS, P1).find((r) => r.id === "r-charm");
    if (!row) throw new Error("fixture");
    const d = draftOf(row);
    expect(draftUnchanged(d, row, P1)).toBe(true);
    expect(
      draftUnchanged({ ...d, rolls: [{ ...row.rolls[0], expression: "1D4" } as never] }, row, P1),
    ).toBe(true);
    expect(draftUnchanged({ ...d, text: `${d.text}!` }, row, P1)).toBe(false);
    expect(draftUnchanged(draftOf(null), undefined, P1)).toBe(false);
    // Inputs: a player's save carries no dmOnly / link (FR-REM-08); kept roll ids ride along.
    expect(saveInput(d, P1)).toEqual({
      id: "r-charm",
      target: { kind: "character", characterId: "mira" },
      text: row.text,
      source: "",
      rolls: [{ id: "rl-charm", label: "Charm", expression: "1d4", category: "saving-throw" }],
    });
    const steam = REMINDERS.find((r) => r.id === "r-steam");
    if (!steam) throw new Error("fixture");
    expect(saveInput({ ...draftOf(steam), dmOnly: true }, DM)).toMatchObject({
      target: { kind: "party" },
      dmOnly: true,
      strongholdId: "h-grey",
      facilityId: "f-steam",
    });
  });

  test("FR-REM-19 a facility without its stronghold is invalid", () => {
    const d = { ...draftOf(null), text: "ok", facilityId: "f1" };
    expect(draftError(d, DM)).toBe("A facility link needs its stronghold");
  });
});

describe("FR-REM-24 states", () => {
  test("FR-REM-24 FR-REM-14 states: skeleton while loading, Retry after a reject, empty Party group text; a player with no characters sees Party only", () => {
    const loading = renderWith(P1, <RemindersTab />, { lazy: "loading" });
    expect(loading).toContain('data-testid="rem-loading"');
    expect(loading).not.toContain('data-testid="rem-group"');
    const error = renderWith(P1, <RemindersTab />, { lazy: "error" });
    expect(error).toContain('data-testid="rem-retry"');
    expect(error).not.toContain('data-testid="rem-loading"');
    const empty = renderWith(P1, <RemindersTab />, { rows: [] });
    expect(empty).toContain('data-testid="rem-empty"');
    expect(empty).toContain("No party reminders yet");
    const none = renderWith({ campaignId: "c", role: "player", playerId: "p3" }, <RemindersTab />);
    expect(attrs(none, "rem-group", "data-record-id")).toEqual([PARTY]);
  });
});

const poisoned = {
  id: "fx-poison",
  kind: "condition",
  condition: "poisoned",
  level: null,
  label: null,
  targetCombatantId: null,
  targetCharacterId: "mira",
  encounterId: "e1",
  endsRound: null,
  seq: 1,
};
const bless = {
  ...poisoned,
  id: "fx-bless",
  kind: "custom",
  condition: null,
  label: "Bless",
  endsRound: 5,
  seq: 2,
};
const hold = {
  ...poisoned,
  id: "fx-conc",
  kind: "concentration",
  condition: null,
  label: "Hold Person",
  seq: 3,
};
const secret = { ...bless, id: "fx-secret", label: "Hex", endsRound: null, secret: true, seq: 4 };
const ended = { ...bless, id: "fx-ended", label: "Shield", endedAt: "t", seq: 5 };
const onThorn = { ...poisoned, id: "fx-thorn", targetCharacterId: "thorn", seq: 6 };

describe("FR-CBTX-70 effects line", () => {
  test("FR-CBTX-70 read-only effects line: Poisoned, Bless 3r and concentration Hold Person for Mira; a secret effect only in the DM render; no menu trigger; none → nothing", () => {
    const effects = [poisoned, bless, hold, secret, ended, onThorn];
    const dm = renderWith(DM, <EffectsLine characterId="mira" />, { effects, round: 2 });
    expect(attrs(dm, "cbtx-effect-chip", "data-record-id")).toEqual([
      "fx-conc",
      "fx-poison",
      "fx-bless",
      "fx-secret",
    ]);
    expect(dm).toContain("Bless 3r");
    expect(dm).toContain("Hold Person");
    expect(dm).toContain("Poisoned");
    expect(attrs(dm, "cbtx-effect-chip", "data-secret")).toEqual([
      "false",
      "false",
      "false",
      "true",
    ]);
    for (const menu of ["aria-haspopup", "cbtx-conc-chip", "cbtx-sheet-effects-menu", "<button"]) {
      expect(dm).not.toContain(menu);
    }
    expect(attrs(dm, "cbtx-effects-line", "data-record-id")).toEqual(["mira"]);
    // A player holds no secret or ended effect (FR-CBTX-31): the line shows what it receives.
    const p1 = renderWith(P1, <EffectsLine characterId="mira" />, {
      effects: [poisoned, bless, hold],
      round: 2,
    });
    expect(attrs(p1, "cbtx-effect-chip", "data-record-id")).toEqual([
      "fx-conc",
      "fx-poison",
      "fx-bless",
    ]);
    expect(renderWith(DM, <EffectsLine characterId="thorn" />, { effects: [ended] })).toBe("");
  });

  test("FR-REM-22 effects block: under each character group in the Party Manager (DM sees the secret one, never an ended one); not on the sheet surface; nothing for a character without effects", () => {
    const effects = [poisoned, secret, ended];
    const dm = renderWith(DM, <RemindersTab />, { effects });
    expect(attrs(dm, "rem-effects", "data-record-id")).toEqual(["mira"]);
    expect(attrs(dm, "cbtx-effect-chip", "data-record-id")).toEqual(["fx-poison", "fx-secret"]);
    const p1 = renderWith(P1, <RemindersTab />, { effects: [poisoned] });
    expect(attrs(p1, "rem-effects", "data-record-id")).toEqual(["mira"]);
    // Player-2 has no Mira group, so no Mira effects line.
    expect(renderWith(P2, <RemindersTab />, { effects: [poisoned] })).not.toContain("rem-effects");
    expect(renderWith(DM, <RemindersTab characterId="mira" />, { effects })).not.toContain(
      "rem-effects",
    );
  });
});

afterEach(() => partyMemory().tabs.bind(null));

describe("FR-PARTY-71 Reminders tab", () => {
  test("FR-PARTY-71 tabs after PM's list: Reminders at order 50 after Loot; a stored `reminders` restores; FR-PARTY-73 the tab hosts REM's list", () => {
    expect(partyTabs().map((t) => [t.id, t.order])).toEqual([
      ["status", 10],
      ["handouts", 20],
      ["inventory", 30],
      ["loot", 40],
      ["reminders", 50],
      ["strongholds", 60], // RS2 (FR-PARTY-71)
    ]);
    expect(PARTY_TAB_ENTRIES.find((t) => t.id === REMINDERS_TAB)?.visible).toBeUndefined();
    for (const you of [DM, P1]) {
      partyMemory().tabs.choose(tabKeyOf(you), REMINDERS_TAB);
      const html = renderWith(you, <PartyBoard parts={{ handouts: null }} />);
      expect(html).toMatch(
        /data-state="active"[^>]*data-testid="party-tab"[^>]*data-value="reminders"/,
      );
      expect(html).toContain('data-testid="rem-tab"');
      expect(attrs(html, "rem-group", "data-record-id")[0]).toBe(PARTY);
    }
  });
});

describe("FR-CHARX-100 sheet tab", () => {
  const ctx = (client: "dm" | "player", you = client === "dm" ? DM : P1) => ({
    slot: "tab" as const,
    client,
    kind: "character" as const,
    store: {
      ...emptyStore(),
      you,
      records: { [ENTITY_TYPE]: Object.fromEntries(ENTITIES.map((e) => [e.id, e])) },
    },
    creatureId: "mira",
  });

  test("FR-CHARX-100 reminders tab: … Reminders, Macros, Trophies on Mira's sheet for the DM and player-1; not offered to player-2; count = Mira's visible reminders once loaded", () => {
    for (const c of [ctx("dm"), ctx("player")]) {
      const ids = sectionsFor(sheetSections, c).map((s) => s.id);
      expect(ids.slice(ids.indexOf("rem.reminders"))).toEqual([
        "rem.reminders",
        "dicex.macros",
        "stats.trophies",
      ]);
    }
    expect(sectionsFor(sheetSections, ctx("player", P2)).map((s) => s.id)).not.toContain(
      "rem.reminders",
    );
    expect(remRemindersSection.title).toBe("Reminders");
    expect(remRemindersSection.kinds).toEqual(["character"]);
    // Count: loaded rows only; party rows not counted; null before the load.
    for (const you of [DM, P1]) {
      const st = syncStore(you).getState();
      const loaded = (t: string) => t === REMINDER_TYPE;
      expect(reminderCount(st.store, "mira", loaded)).toBe(1);
      expect(sectionCount(remRemindersSection, st.store, "mira", loaded)).toBe(1);
      expect(sectionCount(remRemindersSection, st.store, "mira", () => false)).toBeNull();
    }
    const dm = syncStore(DM).getState().store;
    expect(reminderCount(dm, "thorn", () => true)).toBe(2);
    expect(reminderCount(syncStore(P2).getState().store, "thorn", () => true)).toBe(1);
    // Zero → no Badge; a throwing count → no Badge.
    expect(sectionCount(remRemindersSection, dm, "gob", () => true)).toBeNull();
    const bad = {
      ...remRemindersSection,
      count: () => {
        throw new Error("x");
      },
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(sectionCount(bad, dm, "mira", () => true)).toBeNull();
    } finally {
      console.warn = warn;
    }
  });

  test("FR-CHARX-101 contents and roll as: Mira's rows, then Party; every roll as Mira (Steam's party roll included); Open in Party Manager; no effects line", () => {
    const html = renderWith(P1, <RemindersTab characterId="mira" />);
    expect(attrs(html, "rem-group", "data-record-id")).toEqual(["mira", PARTY]);
    expect(attrs(html, "rem-row-roll", "data-actor")).toEqual(["mira", "mira"]);
    const thorn = renderWith(P2, <RemindersTab characterId="thorn" />);
    expect(attrs(thorn, "rem-group", "data-record-id")).toEqual(["thorn", PARTY]);
    expect(attrs(thorn, "rem-row-roll", "data-actor")).toEqual(["thorn"]);
    const Section = remRemindersSection.component;
    const sec = renderWith(P1, <Section creatureId="mira" client="player" />);
    expect(sec).toContain('data-testid="rem-sheet-open-party"');
    expect(sec).not.toContain("rem-effects");
  });

  test("FR-CHARX-102 rights and lock: player-2 on Thorn edits only REM-THORN-OWN; not live → disabled (the sheet lock isn't read)", () => {
    const html = renderWith(P2, <RemindersTab characterId="thorn" />);
    expect(tags(html, "rem-row-menu")).toHaveLength(1);
    expect(attrs(html, "rem-group-add", "data-record-id")).toEqual(["thorn", PARTY]);
    const off = renderWith(P2, <RemindersTab characterId="thorn" />, { live: false });
    expect(tags(off, "rem-row-menu").every((t) => t.includes("disabled"))).toBe(true);
  });

  test("FR-CHARX-104 the sheet's tab strip: `charx-tab` rem.reminders before Macros, `data-count` + Badge once loaded, none before", () => {
    const mira = {
      id: "mira",
      kind: "character",
      name: "Mira",
      campaignId: "c",
      ownerPlayerId: "p1",
      portraitAssetId: null,
      statBlock: CharacterStatBlock.parse({
        size: "medium",
        ac: 14,
        hpMax: 12,
        initBonus: 2,
        attacks: [],
        level: 1,
        className: "Rogue",
      }),
    } as unknown as DefinitionRecord;
    const sheet = (o: { lazy?: "ready" | "loading" } = {}) =>
      renderWith(
        P1,
        <SheetView
          creature={mira}
          row={undefined}
          client="player"
          playerId="p1"
          ownerName="Player 1"
          picker={null}
          startEditing={false}
        />,
        o,
      );
    const html = sheet();
    const tabs = attrs(html, "charx-tab", "data-value");
    expect(tabs.indexOf("section:rem.reminders")).toBe(tabs.indexOf("section:dicex.macros") - 1);
    const tab = tags(html, "charx-tab").find((t) => t.includes("section:rem.reminders")) ?? "";
    expect(tab).toContain('data-count="1"');
    expect(tags(sheet({ lazy: "loading" }), "charx-tab").join()).not.toContain("data-count");
  });
});
