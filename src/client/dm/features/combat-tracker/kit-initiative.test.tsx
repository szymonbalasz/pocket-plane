// Kit parity K2 (kit-parity §6.3, FR-KIT-20 – -29, -72), DM client: the Initiative window on the
// kit grid. Static render over the companions fight (`companions-fixture.tsx`) with tokens and
// effects added; the tail fold is pure (`tailFolds`). Hover, widths and the theme's look in a
// browser: e2e/kit-initiative.e2e.ts and the K2 walkthrough.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { HP_TRACK_PX } from "@ui/components/kit/hp-bar";
import { statusShown } from "@ui/features/combat-extras/parts";
import { companionLayout } from "@ui/features/combat-tracker/companions";
import {
  companionStore,
  DM_ROWS,
  renderWith,
  rowHtml,
} from "@ui/features/combat-tracker/companions-fixture";
import {
  contentWidth,
  HP_STACK,
  HP_TRACK_MIN,
  listTrack,
  medallionColour,
  needsStack,
  STACK_HYSTERESIS,
  trackRoom,
} from "@ui/features/combat-tracker/parts";
import { CREATURE_COLORS } from "@ui/features/scenes-map/theme";
import { END_CONFIRM_LABEL, END_KEEP_LABEL, EndConfirmButtons } from "./end-confirm";
import {
  dmInitiativeWindow,
  INIT_MENU,
  tailFolds,
  tailText,
  wideInitColumn,
} from "./initiative-window";

const Body = dmInitiativeWindow.component;

const effect = (id: string, o: Record<string, unknown>) => ({
  id,
  seq: 1,
  campaignId: "c1",
  encounterId: "e1",
  condition: null,
  level: null,
  label: null,
  targetCombatantId: null,
  targetCharacterId: null,
  endsRound: null,
  endedAt: null,
  secret: false,
  ...o,
});

/**
 * The DM's companions fight at `round`, with the Worg on a beast token, the Goblin on an
 * "initials" token, the Goblin prone + "Hex" (2 rounds), Mira concentrating on Bless + blessed.
 */
function kitStore(round = 1, patch: Record<string, Record<string, unknown>> = {}): RecordStore {
  const s = companionStore("dm");
  const combatant = { ...s.records.combatant } as Record<string, Record<string, unknown>>;
  combatant.wolf = { ...combatant.wolf, tokenId: "t-wolf" };
  combatant.goblin = { ...combatant.goblin, tokenId: "t-gob", movedFt: 15 };
  for (const [id, p] of Object.entries(patch)) combatant[id] = { ...combatant[id], ...p };
  const enc = { ...(s.records.encounter?.e1 as object), round };
  return {
    ...s,
    records: {
      ...s.records,
      encounter: { e1: enc },
      combatant,
      token: {
        "t-wolf": { id: "t-wolf", creatureType: "beast" },
        "t-gob": { id: "t-gob", creatureType: "initials" },
      },
      effect: {
        prone: effect("prone", {
          kind: "condition",
          condition: "prone",
          targetCombatantId: "goblin",
        }),
        hex: effect("hex", {
          kind: "custom",
          label: "Hex",
          targetCombatantId: "goblin",
          endsRound: 3,
          seq: 2,
        }),
        conc: effect("conc", {
          kind: "concentration",
          label: "Bless",
          targetCharacterId: "ch-mira",
        }),
        bless: effect("bless", {
          kind: "custom",
          label: "Bless",
          targetCharacterId: "ch-mira",
          seq: 3,
        }),
      },
    },
  } as RecordStore;
}

const dm = (store = kitStore()) => renderWith(store, <Body kind="cbt.initiative" instance="" />);
/** The opening tag of the first element with `data-testid=id` (and `data-record-id=rec`). */
const tag = (html: string, id: string, rec?: string) =>
  html.match(
    new RegExp(`<\\w+[^>]*data-testid="${id}"${rec ? `[^>]*data-record-id="${rec}"` : ""}[^>]*>`),
  )?.[0] ?? "";
const text = (html: string) => html.replace(/<[^>]+>/g, "");
/** The markup from the element carrying `data-slot=slot` to the end of `html`. */
const fromSlot = (html: string, slot: string) => {
  const at = html.indexOf(`data-slot="${slot}"`);
  return at < 0 ? "" : html.slice(html.lastIndexOf("<", at));
};

describe("FR-KIT-20 header menu", () => {
  test("FR-KIT-20 header menu: one centred line (encounter name, Round N in number type) and the window menu ⋯; Add / Summon / End are its items, not header buttons", () => {
    const html = dm();
    const header = fromSlot(html, "init-header");
    expect(header).toMatch(/data-testid="cbt-init-round" data-value="1"/);
    expect(text(header)).toContain("Ambush at the Ford·Round 1");
    expect(header).toMatch(/Round <span class="[^"]*tabular-nums[^"]*">1<\/span>/);
    expect(tag(html, "cbt-init-menu")).toContain('aria-haspopup="menu"');
    for (const id of ["cbtx-init-add", "cbt-init-summon", "cbt-init-end"]) {
      expect(html).not.toContain(`data-testid="${id}"`);
    }
    expect(INIT_MENU.map((i) => (i.kind === "separator" ? "—" : i.testId))).toEqual([
      "cbtx-init-add",
      "cbt-init-summon",
      "—",
      "cbt-init-end",
    ]);
    expect(INIT_MENU.map((i) => ("label" in i ? i.label : ""))).toEqual([
      "Add…",
      "Summon…",
      "",
      "End encounter…",
    ]);
    expect(INIT_MENU.filter((i) => "destructive" in i && i.destructive).map((i) => i.kind)).toEqual(
      ["end"],
    );
  });
});

describe("FR-KIT-22 footer", () => {
  test("FR-KIT-22 footer: round ≥ 1 → Prev, Undo (icon, its Tooltip the undo text), Next turn on the right, under the list", () => {
    const html = dm();
    const footer = fromSlot(html, "init-footer");
    expect(tag(html, "cbt-init-footer")).toContain('data-slot="init-footer"');
    expect(html.indexOf('data-testid="cbt-init-list"')).toBeLessThan(
      html.indexOf('data-testid="cbt-init-footer"'),
    );
    const order = ["cbt-init-prev", "cbt-init-undo", "cbt-init-next"].map((id) =>
      footer.indexOf(`data-testid="${id}"`),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(tag(footer, "cbt-init-undo")).toContain('aria-label="Nothing to undo"');
    expect(text(footer)).not.toContain("Undo");
    expect(tag(footer, "cbt-init-next")).toContain("ml-auto");
    expect(tag(footer, "cbt-init-next")).toContain('data-variant="default"');
    expect(footer).toMatch(/data-testid="cbt-init-next"[^>]*>Next turn</);
    expect(footer).not.toContain("cbt-init-roll-monsters");
  });

  test("FR-KIT-22 footer: round 0 → the start reason above Roll monsters and Start; no Prev", () => {
    const html = dm(kitStore(0, { goblin: { initiative: null }, wolf: { initiative: null } }));
    const footer = fromSlot(html, "init-footer");
    for (const id of ["cbt-init-start-reason", "cbt-init-roll-monsters", "cbt-init-next"]) {
      expect(footer).toContain(`data-testid="${id}"`);
    }
    expect(footer.indexOf("cbt-init-start-reason")).toBeLessThan(
      footer.indexOf("cbt-init-roll-monsters"),
    );
    expect(footer.indexOf("cbt-init-roll-monsters")).toBeLessThan(
      footer.indexOf('data-testid="cbt-init-next"'),
    );
    expect(footer).toMatch(/data-testid="cbt-init-next"[^>]*>Start round 1</);
    expect(footer).not.toContain("cbt-init-prev");
  });
});

describe("FR-KIT-23 row grid", () => {
  test("FR-KIT-23 row grid: no Combatant / Init strip; the turn row's gem (aria Current turn) on its left edge; the grip on hover / focus only", () => {
    const html = dm();
    expect(text(html)).not.toMatch(/CombatantInit/);
    const wolf = rowHtml(html, "cbt-init-row", "wolf");
    expect(wolf).toContain('data-turn="true"');
    expect(wolf).toMatch(/<span role="img" aria-label="Current turn" data-slot="init-turn"/);
    expect(rowHtml(html, "cbt-init-row", "goblin")).not.toContain("init-turn");
    expect(tag(html, "cbt-init-row", "goblin")).toContain("group/row");
    // The grip sits in a hover-only wrapper, out of the flow.
    const grip = wolf.match(
      /<span class="([^"]*)">(?=<span[^>]*><button[^>]*data-testid="cbtx-init-row-grip")/,
    );
    expect(grip).not.toBeNull();
    if (grip) {
      expect(grip[1]).toContain("absolute");
      expect(grip[1]).toContain("opacity-0");
      expect(grip[1]).toContain("group-hover/row:opacity-100");
      expect(grip[1]).toContain("focus-within:opacity-100");
    }
  });
});

describe("FR-KIT-24 medallion source", () => {
  test("FR-KIT-24 medallion source: the token's creature-type colour, else the neutral muted colour", () => {
    const store = kitStore();
    expect(medallionColour(store, { tokenId: "t-wolf" })).toBe(CREATURE_COLORS.beast);
    expect(medallionColour(store, { tokenId: "t-gob" })).toBeNull();
    expect(medallionColour(store, { tokenId: null })).toBeNull();
    expect(medallionColour(store, { tokenId: "missing" })).toBeNull();
    const html = dm(store);
    const worg = tag(rowHtml(html, "cbt-init-row", "wolf"), "kit-medallion");
    expect(worg).toContain('data-size="lg"');
    expect(worg).toContain(`background-color:${CREATURE_COLORS.beast}`);
    const mira = tag(rowHtml(html, "cbt-init-row", "mira"), "kit-medallion");
    expect(mira).toContain("bg-muted");
    // Companion lines and removed rows: medallion `sm`.
    const line = rowHtml(html, "cbt-init-companion", "drake");
    expect(tag(line, "kit-medallion")).toContain('data-size="sm"');
  });
});

describe("FR-KIT-25 hp line", () => {
  test("FR-KIT-25 hp line: HP bar + cur / max (its band as data-band), then the muted AC / moved tail; no band badge for the DM", () => {
    const html = dm(kitStore(1, { goblin: { hpCurrent: 3 } }));
    const goblin = rowHtml(html, "cbt-init-row", "goblin");
    const hp = tag(goblin, "cbt-init-row-hp", "goblin");
    expect(hp).toContain('data-slot="kit-hpbar"');
    expect(hp).toContain('data-band="bloodied"');
    expect(goblin).toMatch(/data-testid="cbt-init-row-hp"[\s\S]*?>3 \/ 7</);
    expect(goblin).not.toContain('data-testid="cbt-init-row-band"');
    expect(goblin).toMatch(/data-tail="true" data-folded="false"[^>]*>AC —/);
    expect(goblin).toMatch(/data-testid="cbt-init-row-moved"[^>]*>.*15 ft</);
    expect(goblin.indexOf("cbt-init-row-hp")).toBeLessThan(goblin.indexOf("data-tail"));
    expect(tailText(16, "0 / 30 ft")).toBe("AC 16 · moved 0 / 30 ft");
    expect(tailText(null, null)).toBe("AC —");
  });

  test("FR-KIT-25 tail folds: when the line can't hold the bar (K9: its fixed track + numbers), the other parts and the tail", () => {
    // bar 120 + 8 + "38 / 44" 40 = 168; "+5" 14; tail 92; gaps 2 × 6.
    const w = { bar: 168, others: [14], tail: 92 };
    expect(tailFolds({ ...w, line: 286 })).toBe(false);
    expect(tailFolds({ ...w, line: 285 })).toBe(true);
    expect(tailFolds({ line: 100, bar: null, others: [], tail: 92 })).toBe(false);
  });

  test("FR-KIT-25 one track per list (K9 walkthrough F1) at 400 / 320 / 280 with chips: every row's room is measured, the list draws the narrowest, ≤ 120 px, ≥ the readable minimum", () => {
    // Rooms = line − bar rest ("cur / max" 8 + 42) − other parts (+ 6 px gaps). The lines differ
    // per row by their status chips (none / prone / concentration + "+1") and temp "+N".
    const row = (line: number, others: number[] = []) =>
      trackRoom({ line, barRest: 50, others, gap: 6 });
    expect(row(160, [13])).toBe(91);
    // DM 400 (Simple and busy rows): one width, the narrowest row's.
    const w400 = [row(160), row(156), row(160, [13]), row(160), row(160, [13]), row(160)];
    expect(listTrack(w400)).toBe(91);
    // DM 320: narrow-list chips are icon-only, so the busy rows still leave a readable bar.
    const w320 = [row(142), row(98), row(122, [13]), row(120), row(98, [13])];
    expect(listTrack(w320)).toBe(HP_TRACK_MIN);
    expect(listTrack([row(142), row(98), row(122)])).toBe(48);
    // Player 280: Mira's concentration + "+1" + trigger icons.
    expect(listTrack([row(114), row(90), row(130)])).toBe(40);
    // Wide (600): capped at the kit's 120; nothing measured (static render) → 120.
    expect(listTrack([row(300), row(280, [13])])).toBe(HP_TRACK_PX);
    expect(listTrack([])).toBe(HP_TRACK_PX);
    // Never under the readable minimum.
    expect(listTrack([row(60)])).toBe(HP_TRACK_MIN);
  });

  test("FR-KIT-25 one track per list (K9 walkthrough F1): both lists set it (useListHpTrack); the fixed track reads it; narrow-list chips drop their rounds into the Tooltip; a folded tail is inert", () => {
    const src = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");
    expect(src("initiative-window.tsx")).toContain("useListHpTrack(listRef);");
    expect(src("../../../player/features/combat-tracker/initiative-window.tsx")).toContain(
      "useListHpTrack(listRef);",
    );
    expect(src("initiative-window.tsx")).toContain("inert={folded || undefined}");
    const html = dm(kitStore(1, { goblin: { hpCurrent: 3 } }));
    const goblin = rowHtml(html, "cbt-init-row", "goblin");
    expect(goblin).toContain("w-[var(--hp-track,120px)] shrink");
    expect(goblin).toMatch(
      /data-slot="init-status" class="[^"]*@max-\[22rem\]\/init:\[&amp;_\[data-rounds\]\]:hidden/,
    );
    // A timed concentration's "4r" sits in a data-rounds span (hidden in a narrow list, kept in
    // its Tooltip).
    const base = kitStore();
    const timed = {
      ...base,
      records: {
        ...base.records,
        effect: {
          ...base.records.effect,
          conc: { ...(base.records.effect?.conc as object), endsRound: 5 },
        },
      },
    } as RecordStore;
    expect(rowHtml(dm(timed), "cbt-init-row", "mira")).toMatch(
      /<span data-rounds="true" class="shrink-0">4r<\/span>/,
    );
  });

  test("FR-KIT-25 one track per list (K9 re-test R1): DM 320 on session-sim-13, Mira's init + concentration + +1 + Searing Strike trigger leave her a 75-px HP line: the list stacks its HP lines (own full-width line under the name) and every bar shares 120 px again", () => {
    // One-line rows at DM 320: Mira's line 75 px ("12 / 12" + gap = 50) → 25 < the 36 floor;
    // Thorn's 96 px with temp "+5" (13) → 27; the plain rows ≈ 98–142.
    const row = (line: number, others: number[] = []) =>
      trackRoom({ line, barRest: 50, others, gap: 6 });
    const oneLine = [row(142), row(124), row(75), row(96, [13]), row(98), row(110)];
    expect(oneLine[2]).toBe(25);
    expect(needsStack(oneLine)).toBe(true);
    // Stacked: each HP line spans the row under the name, past the medallion (264 − 34 = 230 px).
    const stacked = [row(230), row(230), row(230), row(230, [13]), row(230), row(218)];
    expect(needsStack(stacked)).toBe(false);
    expect(listTrack(stacked)).toBe(HP_TRACK_PX);
    // DM 400 / kit-parity at 320 stay on one line (no row under the floor).
    expect(needsStack([row(160), row(156), row(160, [13])])).toBe(false);
    expect(needsStack([row(142), row(98), row(122, [13])])).toBe(false);
    expect(needsStack([])).toBe(false);
  });

  test("FR-KIT-25 stacking (K9 re-test 2) on session-sim-13 at DM 320 / 340 / 360: one width threshold, rooms measured on the one-line rows the same way at every width (one 22rem narrow breakpoint), a little hysteresis", () => {
    // One-line rooms grow 1:1 with the list (the narrow variants hold from 320 to ≈ 376): the
    // busiest row (Mira: init + concentration + "+1" + the Searing Strike trigger) has 25 at 320.
    const sim13 = (window: number) => {
      const d = window - 320;
      return [94 + d, 25 + d, 61 + d, 36 + d, 74 + d, 58 + d, 58 + d, 70 + d, 82 + d, 90 + d];
    };
    expect(needsStack(sim13(320))).toBe(true);
    expect(needsStack(sim13(330))).toBe(true);
    expect(needsStack(sim13(340))).toBe(false);
    expect(needsStack(sim13(360))).toBe(false);
    // Monotonic: stacked for every width under the threshold, one line above it.
    const stackedAt = [320, 324, 328, 332, 336, 340, 344, 352, 360, 380].map((w) =>
      needsStack(sim13(w)),
    );
    expect(stackedAt.indexOf(false)).toBeGreaterThan(0);
    expect(stackedAt.slice(stackedAt.indexOf(false)).every((x) => !x)).toBe(true);
    // Hysteresis: a stacked list widening to 338 (room 43) stays stacked; at 340 (45 ≥ 36 + 8 =
    // 44) it goes back to one line; a one-line list narrowing to 338 stays one line.
    expect(STACK_HYSTERESIS).toBe(8);
    expect(needsStack(sim13(338), true)).toBe(true);
    expect(needsStack(sim13(340), true)).toBe(false);
    expect(needsStack(sim13(338), false)).toBe(false);
  });

  test("FR-KIT-25 tail folds (K9 re-test 2, N1): a stacked HP line is measured on its content box (its indent is padding), so the AC · ft tail folds into the row Tooltip when it doesn't fit", () => {
    // DM 320 stacked: the line's box is 278 px with a 34-px indent → 244 px of content. Bar 120 +
    // 8 + "35 / 55" 42 = 170, tail "AC 13 · 0 / 40 ft" 95, one gap: 271.
    const g = globalThis as { getComputedStyle?: unknown };
    const had = g.getComputedStyle;
    g.getComputedStyle = () => ({ paddingLeft: "34px", paddingRight: "0px" });
    try {
      const line = contentWidth({ clientWidth: 278 } as HTMLElement);
      expect(line).toBe(244);
      expect(tailFolds({ line, bar: 170, others: [], tail: 95 })).toBe(true);
      // The old reading (the padded box) said it fits, and the tail wrapped under the bar.
      expect(tailFolds({ line: 278, bar: 170, others: [], tail: 95 })).toBe(false);
      // A nested ally at 360 (indented row, 240 px of content): folds too.
      expect(tailFolds({ line: 240, bar: 170, others: [], tail: 95 })).toBe(true);
    } finally {
      g.getComputedStyle = had;
    }
  });

  test("FR-KIT-25 one track per list (K9 re-test R1): the stacked layout is markup for every theme: the list is group/hp; a row's main line wraps, its name block dissolves, the name keeps its own box, the HP line takes a full-width line under it", () => {
    const html = dm(kitStore(1, { goblin: { hpCurrent: 3 } }));
    expect(html).toMatch(/data-testid="cbt-init-list" class="[^"]*group\/hp/);
    const goblin = rowHtml(html, "cbt-init-row", "goblin");
    expect(goblin).toContain(HP_STACK.main);
    expect(goblin).toContain(HP_STACK.block);
    expect(goblin).toMatch(
      /<div class="min-w-0 group-data-\[hp-stacked\]\/hp:flex-1"><div data-name-line/,
    );
    expect(goblin).toMatch(
      /data-stats-line="true" class="[^"]*group-data-\[hp-stacked\]\/hp:basis-full/,
    );
    // Not stacked until the list measures a row under the floor (the static render measures none).
    expect(html).not.toContain("data-hp-stacked");
  });

  test("FR-KIT-28 status icons (K9 walkthrough F1): in a narrow list two or more effects fold into one +N chip (concentration never folds); wide lists keep the first effect", () => {
    expect(statusShown(0, 2, false)).toBe(1);
    expect(statusShown(0, 2, true)).toBe(0);
    expect(statusShown(0, 1, true)).toBe(1);
    expect(statusShown(1, 2, false)).toBe(0);
    expect(statusShown(0, 0, true)).toBe(0);
    // The static render (no list measured) is the wide look: the Goblin's prone shows, Hex in +1.
    const goblin = rowHtml(dm(), "cbt-init-row", "goblin");
    expect(goblin).toContain('data-testid="cbtx-init-row-effect" data-record-id="prone"');
    expect(goblin).toMatch(/data-testid="cbtx-init-row-effect-more" data-value="1"/);
  });

  test("FR-KIT-25 hp line (K9, K6 gap 3): every row's bar on the list's one fixed track, cur / max in a column, the AC / moved tail a right-aligned column", () => {
    const html = dm(kitStore(1, { goblin: { hpCurrent: 3 } }));
    // (Mira's figures live on her character record, not in this fixture: no bar.)
    for (const id of ["goblin", "wolf"]) {
      const row = rowHtml(html, "cbt-init-row", id);
      const hp = row.slice(row.indexOf('data-testid="cbt-init-row-hp"'));
      expect(tag(row, "cbt-init-row-hp", id)).toContain('data-track="fixed"');
      expect(hp).toContain("w-[var(--hp-track,120px)] shrink");
      expect(hp).not.toMatch(/data-slot="kit-hpbar-track" class="[^"]*flex-1/);
      expect(hp).toContain("min-w-[7ch]");
      expect(row).toMatch(/data-tail="true"[^>]*class="ml-auto shrink-0"/);
    }
  });
});

describe("FR-KIT-21 pending list", () => {
  test("FR-KIT-21 pending list (K9, K6 gap 4): each card is one compact line in body type with a muted icon (no stone button), the same IDs and box as the other kinds", () => {
    const store = kitStore();
    const card = {
      id: "n-card",
      seq: 1,
      campaignId: "c1",
      kind: "damage-card",
      state: "pending",
      text: "Mira: 21 to hit, 8 piercing",
      actionRole: "dm",
      actionLabel: "Apply",
      payload: {
        encounterId: "e1",
        attackerId: "mira",
        attackerName: "Mira",
        attackName: "Longbow",
        damageType: "piercing",
        mode: "normal",
        crit: false,
        toHit: null,
        damage: null,
      },
    };
    const html = dm({
      ...store,
      records: { ...store.records, notification: { "n-card": card } },
    } as RecordStore);
    const list = html.slice(html.indexOf('data-testid="cbt-init-pending-list"'));
    expect(list).toContain('data-slot="init-pending-heading"');
    const line = tag(list, "cbt-init-card", "n-card");
    expect(line).toMatch(/^<button type="button"/);
    expect(line).toContain('data-slot="init-pending"');
    expect(line).not.toContain('data-slot="button"');
    expect(line).not.toContain("data-variant");
    expect(line).toContain("h-8");
    expect(line).toContain("text-sm");
    expect(list).toMatch(
      /data-testid="cbt-init-card"[^>]*>[\s\S]*?text-muted-foreground[\s\S]*?Mira: 21 to hit/,
    );
  });
});

describe("FR-KIT-25 init column width (K2 walkthrough F1)", () => {
  test("FR-KIT-25 init column: in-owner's-turn companions (no initiative, no Roll) and companions showing their owner's number never widen it; a listed row that can roll does", () => {
    // The companions fight in round 1: Drake Companion and Fire Elemental 2 act in Brakka's turn
    // and the Owlbear after Mira, none with an initiative of its own; every other row has one.
    const rows = DM_ROWS as unknown as CombatantView[];
    const layout = (r: CombatantView[]) => companionLayout(r, "position");
    expect(rows.filter((c) => c.initiative == null).map((c) => c.id)).toEqual(
      expect.arrayContaining(["drake", "fe2", "owlbear"]),
    );
    expect(wideInitColumn(layout(rows), 1)).toBe(false);
    // A late joiner without initiative shows its Roll button: wide.
    const late = rows.map((c) => (c.id === "goblin" ? { ...c, initiative: null } : c));
    expect(wideInitColumn(layout(late), 1)).toBe(true);
    // Round 0: every row with its own init cell rolls.
    expect(wideInitColumn(layout(rows), 0)).toBe(true);

    const html = dm();
    expect(html).not.toContain('data-testid="cbt-init-row-roll"');
    const cells = [...html.matchAll(/data-slot="init-number" class="([^"]*)"/g)].map((m) => m[1]);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) expect(c).not.toContain("w-[100px]");
    const owl = rowHtml(html, "cbt-init-row", "owlbear");
    expect(owl).toMatch(/data-testid="cbt-init-row-init"[^>]*class="[^"]*w-9/);
  });
});

describe("FR-KIT-27 init edit", () => {
  test("FR-KIT-27 init edit: a set value is the large bare number (the same input, commit on blur / Enter); unset → today's small input + Roll", () => {
    const set = tag(dm(), "cbt-init-row-init", "goblin");
    expect(set).toMatch(/^<input/);
    expect(set).toContain("text-2xl");
    expect(set).toContain('value="12"');
    expect(set).toContain("border-transparent");
    const round0 = dm(kitStore(0, { goblin: { initiative: null } }));
    const unset = tag(round0, "cbt-init-row-init", "goblin");
    expect(unset).not.toContain("text-2xl");
    expect(unset).toContain('data-missing="true"');
    expect(tag(round0, "cbt-init-row-roll", "goblin")).toContain(">");
    // An after-owner companion keeps the read-only number.
    expect(tag(round0, "cbt-init-row-init", "owlbear")).toMatch(/^<span/);
  });
});

describe("FR-KIT-28 status icons", () => {
  test("FR-KIT-28 status icons: the first effect as an icon (+ rounds), then +N; concentration first, its menu chip kept", () => {
    const html = dm();
    const goblin = fromSlot(rowHtml(html, "cbt-init-row", "goblin"), "init-status");
    const chips = [
      ...goblin.matchAll(/data-testid="cbtx-init-row-effect" data-record-id="(\w+)"/g),
    ];
    expect(chips.map((m) => m[1])).toEqual(["prone"]);
    expect(tag(goblin, "cbtx-init-row-effect")).toContain('data-compact="true"');
    expect(tag(goblin, "cbtx-init-row-effect-more")).toContain('data-value="1"');
    // The label for screen readers only; the full text in the Tooltip.
    expect(goblin).toMatch(/<span class="sr-only">Prone<\/span>/);
    const mira = fromSlot(rowHtml(html, "cbt-init-row", "mira"), "init-status");
    expect(mira).toContain('data-testid="cbtx-conc-chip"');
    expect(tag(mira, "cbtx-init-row-effect")).toContain('data-compact="true"');
    expect(tag(mira, "cbtx-init-row-effect-more")).toContain('data-value="1"');
    // No effects → no status box content.
    expect(rowHtml(html, "cbt-init-row", "thorn")).toMatch(/data-slot="init-status"[^>]*><\/span>/);
  });
});

describe("FR-KIT-29 hover actions", () => {
  test("FR-KIT-29 hover actions: Attack and ⋯ in one hover group, shown on hover, focus, an open menu, the turn row and (hover: none)", () => {
    const html = dm();
    const goblin = rowHtml(html, "cbt-init-row", "goblin");
    const group = goblin.match(/<span data-slot="init-actions" class="([^"]*)"/)?.[1] ?? "";
    for (const c of [
      "opacity-0",
      "group-hover/row:opacity-100",
      "focus-within:opacity-100",
      "group-data-[turn=true]/row:opacity-100",
      "has-[[data-state=open]]:opacity-100",
      "[@media(hover:none)]:opacity-100",
    ]) {
      expect(group).toContain(c);
    }
    const actions = fromSlot(goblin, "init-actions");
    expect(actions).toContain('data-testid="cbt-init-row-attack"');
    expect(actions).toContain('data-testid="cbt-init-row-menu"');
  });
});

describe("FR-KIT-03 reachable", () => {
  test("FR-KIT-03 reachable: every row control keeps its ID in the row, the header items in the window menu", () => {
    const goblin = rowHtml(dm(), "cbt-init-row", "goblin");
    for (const id of [
      "cbt-init-row-name",
      "cbt-init-row-hp",
      "cbt-init-row-moved",
      "cbt-init-row-init",
      "cbtx-init-row-effect",
      "cbt-init-row-attack",
      "cbt-init-row-menu",
    ]) {
      expect(goblin).toContain(`data-testid="${id}"`);
    }
    expect(INIT_MENU.filter((i) => i.kind !== "separator")).toHaveLength(3);
  });
});

describe("FR-KIT-01 same DOM per theme", () => {
  test("FR-KIT-01 same DOM per theme: the window renders identically inside a gilt and a Simple Dark element", () => {
    const store = kitStore();
    const inside = (theme: string | null) =>
      renderWith(
        store,
        <div data-theme={theme ?? undefined}>
          <Body kind="cbt.initiative" instance="" />
        </div>,
      ).replace(/^<div[^>]*>/, "");
    expect(inside("gilt")).toBe(inside(null));
  });
});

describe("FR-KIT-07 slots present", () => {
  test("FR-KIT-07 slots present: init-header, init-row, init-turn, init-number, init-status, init-actions, init-footer", () => {
    const html = dm();
    for (const slot of [
      "init-header",
      "init-row",
      "init-turn",
      "init-number",
      "init-status",
      "init-actions",
      "init-footer",
      "kit-medallion",
      "kit-hpbar",
    ]) {
      expect(html).toContain(`data-slot="${slot}"`);
    }
  });
});

describe("FR-KIT-72 end copy", () => {
  test("FR-KIT-72 end copy: Keep fighting (outline) and End encounter (destructive, the confirm ID) for Initiative and Encounters", () => {
    expect([END_KEEP_LABEL, END_CONFIRM_LABEL]).toEqual(["Keep fighting", "End encounter"]);
    for (const id of ["cbt-init-end-confirm", "cbt-enc-end-confirm"] as const) {
      // The dialog's portal renders nothing statically: the footer's buttons alone.
      const html = renderWith(
        kitStore(),
        <EndConfirmButtons testId={id} disabled={false} onKeep={() => {}} onEnd={() => {}} />,
      );
      expect(html).toMatch(/data-variant="outline"[^>]*>Keep fighting</);
      expect(html).toMatch(
        new RegExp(`data-variant="destructive"[^>]*data-testid="${id}"[^>]*>End encounter<`),
      );
      expect(html).not.toContain(">Cancel<");
    }
  });
});
