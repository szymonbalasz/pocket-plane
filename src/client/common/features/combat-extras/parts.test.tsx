// Sprint 6 WF4 (BL-43, sim-9 c03 / c10): an Initiative row's name is never cut, its fixed parts
// counted (FR-CBTX-57), and a trigger chip is whole or icon-only (FR-CBTX-58). The fit rules on
// stubbed natural widths (the DM's and the player's rows share `NameLine` / `EffectChips`), the
// markup (static render); the rows in a browser at 400 / 320 (DM) and 280 / 240 (player):
// e2e/init-rows-s6.e2e.ts.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../../components/ui/overlays";
import type { TriggerChip } from "../effect-modifiers/trigger-badges";
import { fitChipRow, fitNameLine, MORE_W } from "./logic";
import { EffectChips, NameLine, RowName, TriggerChipView } from "./parts";

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      {node}
    </TooltipProvider>,
  );

// Natural widths as measured in the build (text-sm / 11 px text): the name line of a DM row at
// the 400 default and at the 320 min, a player row at 280 / 240; "Goblin Lurker" (medium), the
// eye-off icon, the "Ally" chip, Moved "15 / 30 ft".
const DM_400 = 206;
const DM_320 = 126;
const P_280 = 150;
const lurker = 94;
const eye = 14;
const ally = 46;
const moved = 62;

const searing = (o: Partial<TriggerChip> = {}): TriggerChip => ({
  id: "searing",
  triggerId: "t-searing",
  name: "Searing Strike",
  uses: { left: 1, text: "1" },
  state: "uses",
  muted: false,
  down: false,
  tooltip: "1 use left",
  ...o,
});

describe("FR-CBTX-57 hidden ally name whole", () => {
  test("FR-CBTX-57 hidden ally name whole: the room = line − the name's natural width − its fixed parts − the gaps", () => {
    // Name + eye-off + Ally + Moved + chips on a 300-px line: 300 − 94 − (4 + 14) − (4 + 46) −
    // (4 + 62) − 4.
    expect(
      fitNameLine({ line: 300, name: lurker, marks: [eye], side: ally, end: moved, chips: true }),
    ).toEqual({
      nameWrap: false,
      marksWrap: false,
      split: false,
      room: 300 - 94 - 18 - 50 - 66 - 4,
    });
    // Less than a "+N" chip's room left (the same at the 400 default) → the second line.
    expect(
      fitNameLine({
        line: DM_400,
        name: lurker,
        marks: [eye],
        side: ally,
        end: moved,
        chips: true,
      }),
    ).toEqual({ nameWrap: false, marksWrap: false, split: true, room: DM_400 - 46 - 4 });
    // Without Moved (round 0) the chips get its room too; no side chip: its room as well.
    expect(
      fitNameLine({ line: DM_400, name: lurker, marks: [eye], side: ally, end: 0, chips: true })
        .room,
    ).toBe(DM_400 - 94 - 18 - 50 - 4);
    expect(
      fitNameLine({ line: DM_400, name: lurker, marks: [], side: 0, end: 0, chips: true }).room,
    ).toBe(DM_400 - 94 - 4);
    // The room is what FR-CBTX-54's steps run against: a 99-px Searing Strike chip fits 112 px
    // in full, and goes icon-only in 60.
    expect(fitChipRow([], [{ full: 99, short: 30 }], 112).icons).toBe(false);
    expect(fitChipRow([], [{ full: 99, short: 30 }], 60).icons).toBe(true);
  });

  test("FR-CBTX-57 hidden ally name whole: 'Goblin Lurker' hidden + Ally at 400 on one line; at 320 the Ally chip takes the second line (sim-9 c10)", () => {
    // c10: "Goblin Lur…" (86 / 83 px) — the row had no chips, so nothing made room for the name.
    expect(
      fitNameLine({ line: DM_400, name: lurker, marks: [eye], side: ally, end: 0, chips: false }),
    ).toEqual({ nameWrap: false, marksWrap: false, split: false, room: 0 });
    // 320: 94 + 4 + 14 + 4 + 46 = 162 > 126 → the side chip moves, the eye-off stays.
    expect(
      fitNameLine({ line: DM_320, name: lurker, marks: [eye], side: ally, end: 0, chips: false }),
    ).toEqual({ nameWrap: false, marksWrap: false, split: true, room: 0 });
    // Player rows (no eye-off: players never get hidden rows) at 280 / 240.
    expect(
      fitNameLine({ line: P_280, name: lurker, marks: [], side: ally, end: 0, chips: false }).split,
    ).toBe(false);
    expect(
      fitNameLine({ line: 110, name: lurker, marks: [], side: ally, end: 0, chips: false }).split,
    ).toBe(true);
  });

  test("FR-CBTX-57 hidden ally name whole: 'Elite Goblin Warrior' hidden with 2 effects → the chips wrap, the name whole; a 40-character name at 280 → two lines, never an ellipsis", () => {
    const elite = 128;
    // 400: name + eye-off fit with a "+N" chip's room → the chips stay, tightened / folded.
    const wide = fitNameLine({
      line: DM_400,
      name: elite,
      marks: [eye],
      side: 0,
      end: 0,
      chips: true,
    });
    expect(wide).toEqual({
      nameWrap: false,
      marksWrap: false,
      split: false,
      room: DM_400 - 128 - 18 - 4,
    });
    expect(wide.room).toBeGreaterThanOrEqual(MORE_W);
    // Less than a "+N" chip's room left → the chips take the second line, the whole line theirs.
    const tight = fitNameLine({
      line: 170,
      name: elite,
      marks: [eye],
      side: 0,
      end: 0,
      chips: true,
    });
    expect(tight).toEqual({ nameWrap: false, marksWrap: false, split: true, room: 170 });
    // With the Ally chip: the second line starts with it; the chips get the rest.
    expect(
      fitNameLine({ line: 170, name: elite, marks: [eye], side: ally, end: 0, chips: true }),
    ).toEqual({ nameWrap: false, marksWrap: false, split: true, room: 170 - 46 - 4 });
    // 40 characters (≈ 300 px) at the player's 280 → the name wraps; chips and side chip below.
    expect(
      fitNameLine({ line: P_280, name: 300, marks: [], side: ally, end: 0, chips: true }),
    ).toEqual({ nameWrap: true, marksWrap: false, split: true, room: P_280 - 46 - 4 });
    // DM 320 (sim-9 Ambush): "Elite Goblin Warrior" (125, longest word ≈ 50) fits its 138-px line
    // but not with the eye-off (+ 4 + 14): it wraps between words, the eye-off beside it, the
    // chips on the second line, Moved after them (T3). A one-word name keeps its line whole and
    // the eye-off leads the second line, the chips get the rest of it (sprint 6 CP2 note 3: never
    // break a word that fits).
    expect(
      fitNameLine({ line: 138, name: 125, word: 50, marks: [eye], side: 0, end: 60, chips: true }),
    ).toEqual({ nameWrap: true, marksWrap: false, split: true, room: 138 - 60 - 4 });
    expect(
      fitNameLine({ line: 138, name: 125, marks: [eye], side: 0, end: 60, chips: true }),
    ).toEqual({ nameWrap: false, marksWrap: true, split: true, room: 138 - 18 });
    // Wider than the line alone (150 on 138): it wraps; Moved follows the chips below.
    expect(
      fitNameLine({ line: 138, name: 150, marks: [eye], side: 0, end: 60, chips: true }),
    ).toEqual({ nameWrap: true, marksWrap: false, split: true, room: 138 - 60 - 4 });
    // No chips, no side chip: nothing moves, the name still wraps rather than being cut.
    expect(
      fitNameLine({ line: P_280, name: 300, marks: [], side: 0, end: 0, chips: false }),
    ).toEqual({ nameWrap: true, marksWrap: false, split: false, room: 0 });
  });

  test("FR-CBTX-57 hidden ally name whole: the name has no truncation; it wraps (no ellipsis) only when wider than its line", () => {
    const one = render(<RowName name="Goblin Lurker" testId="cbt-init-row-name" />);
    expect(one).not.toContain("truncate");
    expect(one).not.toContain("…");
    expect(one).toContain("whitespace-nowrap");
    expect(one).toContain('data-value="Goblin Lurker"');
    const two = render(
      <RowName name="Bartholomew the Exceedingly Long-Winded 3" testId="cbt-init-row-name" wrap />,
    );
    // Between words; a word broken only when it alone is wider than the line (CP2 note 3).
    expect(two).toContain("wrap-break-word");
    expect(two).not.toContain("wrap-anywhere");
    expect(two).not.toContain("truncate");
    // "Goblin 2": base and number in their own spans.
    expect(render(<RowName name="Goblin 2" testId="cbt-init-row-name" />)).toContain(
      '<span data-name-suffix="true" class="whitespace-pre"> 2</span>',
    );
    // The line: the name's measuring copy (never shown, no test ID), the marks beside the name,
    // the side chip slot.
    const line = render(
      <NameLine
        name="Goblin Lurker"
        testId="cbt-init-row-name"
        marks={<span data-testid="eye">eye</span>}
        side={<span data-testid="ally">Ally</span>}
      />,
    );
    expect(line).toContain('data-name-measure="true"');
    expect(line.match(/data-testid="cbt-init-row-name"/g)).toHaveLength(1);
    expect(line.indexOf('data-testid="eye"')).toBeLessThan(line.indexOf("data-name-side"));
    expect(line).toContain('data-split="false"');
  });
});

describe("FR-CBTX-58 trigger label never cut", () => {
  test("FR-CBTX-58 trigger label never cut: no width cap or ellipsis on a trigger chip; the fit measures its natural width", () => {
    const full = render(<TriggerChipView t={searing()} />);
    expect(full).toContain("<span>Searing Strike</span>");
    expect(full).not.toContain("truncate");
    expect(full).not.toContain("max-width");
    expect(full).not.toContain("max-w-");
    // The row's measuring copy is uncapped too (sim-9 c03: capped at 96 px it "fit", then CSS cut it).
    const row = render(
      <EffectChips
        compact
        effects={[]}
        triggers={[searing()]}
        round={1}
        testId="cbtx-init-row-effect"
      />,
    );
    const measure = row.slice(row.indexOf('data-chip-measure="trigger"'), row.indexOf("</div>"));
    expect(measure).toContain("<span>Searing Strike</span>");
    expect(measure).not.toContain("max-width");
    expect(measure).not.toContain("truncate");
  });

  test("FR-CBTX-58 trigger label never cut: Mira's Searing trigger + 'uses 1' at 400 → full label; at 320 → icon-only '⚡1' with the Tooltip sentence", () => {
    // Natural widths: "Searing Strike 1" 99, icon-only "⚡1" 30. Mira's line: name 30, Moved 62
    // on it at 400; at 320 Moved takes the AC / HP line (P3 glitch 10).
    const chip = { full: 99, short: 30 };
    const at = (line: number, end: number) =>
      fitChipRow(
        [],
        [chip],
        fitNameLine({ line, name: 30, marks: [], side: 0, end, chips: true }).room,
      );
    expect(at(DM_400, moved)).toEqual({ n: 0, tier: 0, icons: false, wrap: false });
    expect(at(DM_320, 0)).toEqual({ n: 0, tier: 0, icons: true, wrap: false });
    const icon = render(<TriggerChipView t={searing()} icon />);
    expect(icon).toContain('data-compact="true"');
    expect(icon).toContain('data-value="1"');
    expect(icon).toContain('<span class="sr-only">Searing Strike</span>');
    expect(icon).not.toContain("truncate");
  });

  test("FR-CBTX-58 trigger label never cut: a used trigger keeps muted + check, full or icon-only", () => {
    const used = searing({ state: "used", muted: true, uses: { left: 0, text: "0" } });
    for (const icon of [false, true]) {
      const html = render(<TriggerChipView t={used} icon={icon} />);
      expect(html).toContain('data-muted="true"');
      expect(html).toContain('aria-label="Used"');
      expect(html).toContain("opacity-70");
      expect(html).not.toContain("truncate");
    }
  });
});

describe("FR-CBTX-57 the eye-off stays beside the name (T3, Gilt & Stone default)", () => {
  // Measured in the build at the DM's 320 min, the hidden Ally row (init-rows-s6, sim-9): the
  // name line is 74 px; "Goblin Lurker" is 74 (Goblin 37, Lurker 35) under Gilt & Stone and 86
  // (42, 40) under Simple Dark.
  const line = 74;
  test("FR-CBTX-57 the eye-off stays beside the name: 'Goblin Lurker' filling its 74-px line exactly wraps between words in both themes; the eye-off and Ally never leave the name for the eye's sake", () => {
    const gilt = { line, name: 74, word: 37, marks: [eye], side: ally, end: 0, chips: false };
    const simpleDark = { ...gilt, name: 86, word: 42 };
    for (const w of [gilt, simpleDark]) {
      expect({ name: w.name, fit: fitNameLine(w) }).toEqual({
        name: w.name,
        fit: { nameWrap: true, marksWrap: false, split: true, room: 0 },
      });
    }
    // With chips: they get the second line after the Ally chip, nothing for moved marks.
    expect(fitNameLine({ ...gilt, chips: true })).toEqual({
      nameWrap: true,
      marksWrap: false,
      split: true,
      room: line - ally - 4,
    });
    // The longest word + the eye-off don't fit (37 + 18 > 50): the marks move down instead.
    expect(fitNameLine({ ...gilt, line: 50, name: 50 })).toMatchObject({
      nameWrap: false,
      marksWrap: true,
    });
    // Room for name + eye-off on one line: nothing wraps.
    expect(fitNameLine({ ...gilt, line: 92 })).toMatchObject({ nameWrap: false, marksWrap: false });
  });
});

describe("FR-CBTX-57 a word that fits never breaks (sprint 6 CP2, walkthrough note 3)", () => {
  // DM 320, the Owlbear's row indented under Mira: "Owlbear" (58) fits its 96-px line; with its
  // mode icon (14), hidden eye (14), owner chip and Ally chip it doesn't.
  const owlbear = 58;
  const modeIcon = 14;
  test("FR-CBTX-57 a word that fits never breaks: 'Owlbear' keeps its line; the marks, then the chips, move down", () => {
    const fit = fitNameLine({
      line: 66,
      name: owlbear,
      marks: [modeIcon],
      side: 46 + 4 + 40,
      end: 0,
      chips: true,
    });
    expect(fit.nameWrap).toBe(false);
    expect(fit.marksWrap).toBe(true);
    expect(fit.split).toBe(true);
    // The name still fits beside its marks on a wider line: nothing moves.
    expect(
      fitNameLine({ line: 96, name: owlbear, marks: [modeIcon], side: 0, end: 0, chips: false }),
    ).toEqual({ nameWrap: false, marksWrap: false, split: false, room: 0 });
    // Only a name wider than the line wraps.
    expect(
      fitNameLine({ line: 50, name: owlbear, marks: [], side: 0, end: 0, chips: false }),
    ).toMatchObject({ nameWrap: true, marksWrap: false });
  });

  test("FR-CBTX-57 a word that fits never breaks: the markup — the unwrapped name is nowrap, a wrapping one breaks between words (overflow-wrap: break-word), the marks render once", () => {
    const one = render(
      <RowName name="Owlbear" testId="cbt-init-row-name" className="text-sm font-medium" />,
    );
    expect(one).toContain("whitespace-nowrap");
    expect(one).not.toContain("wrap-anywhere");
    const long = render(<RowName name="Owlbear of the Northern Wastes" testId="x" wrap />);
    expect(long).toContain("wrap-break-word");
    expect(long).not.toContain("wrap-anywhere");
    expect(long).not.toContain("break-all");
    // Static render (no measurement): the marks sit beside the name, once.
    const line = render(
      <NameLine
        name="Owlbear"
        testId="cbt-init-row-name"
        marks={<span data-testid="mode">m</span>}
        side={<span data-testid="owner">Mira</span>}
      />,
    );
    expect(line.match(/data-testid="mode"/g)).toHaveLength(1);
    expect(line.match(/data-name-marks/g)).toHaveLength(1);
  });
});

describe("FR-CBT-143 names break only between words", () => {
  test("FR-CBT-143 no mid-word break: a wrapped name keeps its longest word's width (capped at the line); no break-all / anywhere", () => {
    // Wrapped: `overflow-wrap: break-word` (doesn't shrink min-content) + a min width = the
    // longest word, so "Drake / Compa / nion" can't happen; never `min-w-0`, `break-all` or
    // `anywhere`.
    const wrapped = render(
      <RowName name="Drake Companion" testId="cbt-init-row-name" wrap minW={71} />,
    );
    expect(wrapped).toContain('class="wrap-break-word"');
    expect(wrapped).toContain("min-width:71px");
    for (const bad of ["min-w-0", "break-all", "wrap-anywhere", "anywhere"]) {
      expect(wrapped).not.toContain(bad);
    }
    // The line measures each word (one hidden span per word) for that min width.
    const line = render(<NameLine name="Fire Elemental 2" testId="cbt-init-row-name" />);
    expect(line.match(/data-word-measure="true"/g)).toHaveLength(3);
    expect(line).toContain(">Elemental<");
    // Unwrapped: one line, no wrapping at all.
    expect(render(<RowName name="Goblin Lurker" testId="x" />)).toContain("whitespace-nowrap");
  });
});
