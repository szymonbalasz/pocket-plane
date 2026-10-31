// The DM's rule (fix/sheet-full-text): text a person reads to play shows in full, wrapped; a
// Tooltip holding it does not count. These spots sit in portalled menus or need a live window to
// render, so the guard reads their source; the rendered ones are tested beside their features
// (`print-sheet.test.tsx`, `strongholds.test.tsx`, `stores.test.tsx`, `reminders.test.tsx`, …).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const SPOTS: readonly { what: string; file: string; shown: string; cut: string }[] = [
  {
    what: "the chips' +N list shows a folded effect's whole text",
    file: "common/features/combat-extras/parts.tsx",
    shown: '<span className="min-w-0 [overflow-wrap:anywhere]">{chipText(e, round)}</span>',
    // The chip itself (one line by design, FR-CBTX-46) keeps its own `truncate`; this is the list.
    cut: `aria-hidden />
              <span className="truncate">{chipText(e, round)}</span>`,
  },
  {
    what: "the chips' +N list shows a trigger's whole line",
    file: "common/features/combat-extras/parts.tsx",
    shown: '<span className="min-w-0 [overflow-wrap:anywhere]">{triggerLine(t)}</span>',
    cut: '<span className="truncate">{triggerLine(t)}</span>',
  },
  {
    what: "a trigger's long name wraps",
    file: "common/features/effect-modifiers/triggers.tsx",
    shown: '<span className="min-w-0 [overflow-wrap:anywhere]">{t.name}</span>',
    cut: '<span className="min-w-0 truncate">{t.name}</span>',
  },
  {
    what: "a preset's name wraps in the DM's preset manager",
    file: "dm/features/effect-modifiers/preset-manager.tsx",
    shown: '<span className="min-w-0 [overflow-wrap:anywhere]">{c.preset.name}</span>',
    cut: '<div className="flex items-center gap-1 truncate">',
  },
  {
    what: "a preset's modifiers and note show whole",
    file: "dm/features/effect-modifiers/preset-manager.tsx",
    shown:
      '<div className="text-xs [overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground">',
    cut: '<div className="truncate text-xs text-muted-foreground">',
  },
  {
    what: "the token menu's custom effect name wraps",
    file: "dm/features/effect-modifiers/token-menu-entries.tsx",
    shown: '<div className="[overflow-wrap:anywhere]">{effectName(e)}</div>',
    cut: '<div className="truncate">{effectName(e)}</div>',
  },
  {
    what: "a handout's long title wraps",
    file: "common/features/party-board/HandoutList.tsx",
    shown:
      '<span className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium">{h.title}</span>',
    cut: '<span className="truncate text-sm font-medium">{h.title}</span>',
  },
  {
    what: "the Take list's item name wraps",
    file: "common/features/party-board/Inventory.tsx",
    shown: '<span className="min-w-0 flex-auto [overflow-wrap:anywhere]">{s.row.name}</span>',
    cut: '<span className="min-w-0 flex-1 truncate">{s.row.name}</span>',
  },
  {
    what: "the Combat gem's damage type shows whole",
    file: "common/features/gems/combat-action.tsx",
    shown: '<span className="min-w-14 text-xs text-muted-foreground">{part.type}</span>',
    cut: '<span className="w-14 truncate text-xs text-muted-foreground">{part.type}</span>',
  },
  {
    what: "the tray's issue line wraps whole, no hover title",
    file: "common/features/dice-extras/TrayWindow.tsx",
    shown: '<p data-testid="dicex-tray-issue" role="status">',
    cut: "title={issue}",
  },
  {
    what: "the tray's error line wraps whole, no hover title",
    file: "common/features/dice-extras/TrayWindow.tsx",
    shown: '<p data-testid="dicex-tray-error" role="alert">',
    cut: "title={error}",
  },
  {
    what: "the roll control's error line in the tray wraps whole, no hover title",
    file: "common/features/dice-extras/TrayWindow.tsx",
    shown: '<p role="alert">{control.error}</p>',
    cut: "title={control.error}",
  },
];

describe("full text in menus and live windows", () => {
  for (const s of SPOTS) {
    test(`full text: ${s.what}`, () => {
      const src = readFileSync(resolve(root, s.file), "utf8");
      expect(src).toContain(s.shown);
      expect(src).not.toContain(s.cut);
    });
  }
});

const read = (file: string) => readFileSync(resolve(root, file), "utf8");

// The walkthrough's defects, each measured in a real window by an e2e spec: `full-text-fit-effects`
// (trigger rows), `full-text-fit-party` (long words, reminder rows), `full-text-tray-bar` (the
// tray's Roll bar), `sheet-full-text` (the level line).
describe("full text: rows make room instead of squeezing their text", () => {
  test("full text: a trigger row's badges and controls flow to another line; its name has the width", () => {
    const src = read("common/features/effect-modifiers/triggers.tsx");
    expect(src).toContain('className="flex flex-wrap items-start gap-2 text-sm"');
    expect(src).toContain('<div className="min-w-0 flex-[1_1_8rem]">');
    expect(src).toContain('<div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">');
    expect(src).toContain('<span className="ml-auto flex shrink-0 items-start gap-2">');
  });

  test("full text: a reminder row's badge and menu flow under its text, which never drops below 10rem", () => {
    const src = read("common/features/reminders/ReminderRow.tsx");
    expect(src).toContain('<div className="flex min-w-0 flex-wrap items-start gap-1.5">');
    expect(src).toContain(
      'className="min-w-0 flex-[1_1_10rem] text-sm [overflow-wrap:anywhere] whitespace-pre-wrap"',
    );
  });

  for (const [what, file, row] of [
    [
      "an inventory row's buttons",
      "common/features/party-board/Inventory.tsx",
      '"flex flex-wrap items-baseline gap-x-2 py-1.5 text-sm"',
    ],
    [
      "the Take list's quantity",
      "common/features/party-board/Inventory.tsx",
      '"flex w-full flex-wrap items-baseline gap-x-2 rounded',
    ],
    [
      "a handout's New mark",
      "common/features/party-board/HandoutList.tsx",
      '<span className="flex flex-wrap items-center gap-x-1.5">',
    ],
    [
      "a rule's DM only badge",
      "common/features/compendium/rules/RulesWindow.tsx",
      '<span className="flex min-w-0 flex-wrap items-center gap-x-1.5">',
    ],
    [
      "a feature's source",
      "common/features/character-sheet/MoreTabs.tsx",
      '<div className="flex flex-wrap items-baseline justify-between gap-x-2">',
    ],
    [
      "the stat block's In combat badge",
      "dm/features/entities/statblock/window.tsx",
      '<div className="flex flex-wrap items-center gap-x-2">',
    ],
  ] as const) {
    test(`full text: ${what} flows to another line instead of squeezing the name`, () => {
      expect(read(file)).toContain(row);
    });
  }
});

describe("full text: a long word can't widen a row", () => {
  for (const [what, file, shown] of [
    [
      "a stronghold facility's effect",
      "common/features/strongholds/FacilitiesTab.tsx",
      'className="text-xs [overflow-wrap:anywhere] whitespace-pre-wrap"',
    ],
    [
      "an inventory item's notes",
      "common/features/party-board/Inventory.tsx",
      'className="pb-1.5 text-xs [overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground"',
    ],
    [
      "an inventory item's name",
      "common/features/party-board/Inventory.tsx",
      'className="min-w-0 flex-auto [overflow-wrap:anywhere]"',
    ],
    [
      "a reminder's roll label",
      "common/features/reminders/ReminderRow.tsx",
      '<span className="min-w-0 [overflow-wrap:anywhere]">{roll.label}</span>',
    ],
    [
      "a party row's error",
      "common/features/party-board/RowError.tsx",
      "w-full basis-full [overflow-wrap:anywhere] text-xs",
    ],
    [
      "the party status line",
      "common/features/party-board/StatusTab.tsx",
      'className="[overflow-wrap:anywhere] text-muted-foreground"',
    ],
  ] as const) {
    test(`full text: ${what} has no minimum width to push the scroll area's table`, () => {
      expect(read(file)).toContain(shown);
    });
  }
});

describe("full text: the tray and the sheet header", () => {
  test("full text: the tray's messages scroll in their own area, so a long one can't push the Roll bar out", () => {
    const src = read("common/features/dice-extras/TrayWindow.tsx");
    expect(src).toContain('data-testid="dicex-tray-messages"');
    expect(src).toContain(
      'className="min-h-0 overflow-y-auto [overflow-wrap:anywhere] text-xs text-destructive"',
    );
    expect(src.indexOf("dicex-tray-messages")).toBeLessThan(
      src.indexOf('data-testid="dicex-tray-bar"'),
    );
    // The bar keeps its own height: only the messages (and the dice area) give way.
    expect(src).toContain('className="flex shrink-0 flex-col gap-1.5 border-t pt-1"');
  });

  test("full text: the header's level line wraps a part too long for the column, never cuts it", () => {
    const src = read("common/features/character-sheet/SheetView.tsx");
    expect(src).toContain('<span className="inline-block max-w-full">· {p}</span>');
    expect(src).toContain('<span className="inline-block max-w-full">· {background}</span>');
    expect(src).not.toContain('<span className="whitespace-nowrap">· {p}</span>');
    expect(src).not.toContain('<span className="whitespace-nowrap">· {background}</span>');
  });
});
