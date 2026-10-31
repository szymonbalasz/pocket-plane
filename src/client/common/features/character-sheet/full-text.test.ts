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
    shown: '<span className="min-w-0 break-words">{chipText(e, round)}</span>',
    // The chip itself (one line by design, FR-CBTX-46) keeps its own `truncate`; this is the list.
    cut: `aria-hidden />
              <span className="truncate">{chipText(e, round)}</span>`,
  },
  {
    what: "the chips' +N list shows a trigger's whole line",
    file: "common/features/combat-extras/parts.tsx",
    shown: '<span className="min-w-0 break-words">{triggerLine(t)}</span>',
    cut: '<span className="truncate">{triggerLine(t)}</span>',
  },
  {
    what: "a trigger's long name wraps",
    file: "common/features/effect-modifiers/triggers.tsx",
    shown: '<span className="min-w-0 break-words">{t.name}</span>',
    cut: '<span className="min-w-0 truncate">{t.name}</span>',
  },
  {
    what: "a preset's name wraps in the DM's preset manager",
    file: "dm/features/effect-modifiers/preset-manager.tsx",
    shown: '<span className="min-w-0 break-words">{c.preset.name}</span>',
    cut: '<div className="flex items-center gap-1 truncate">',
  },
  {
    what: "a preset's modifiers and note show whole",
    file: "dm/features/effect-modifiers/preset-manager.tsx",
    shown: '<div className="text-xs break-words whitespace-pre-wrap text-muted-foreground">',
    cut: '<div className="truncate text-xs text-muted-foreground">',
  },
  {
    what: "the token menu's custom effect name wraps",
    file: "dm/features/effect-modifiers/token-menu-entries.tsx",
    shown: '<div className="break-words">{effectName(e)}</div>',
    cut: '<div className="truncate">{effectName(e)}</div>',
  },
  {
    what: "a handout's long title wraps",
    file: "common/features/party-board/HandoutList.tsx",
    shown: '<span className="min-w-0 break-words text-sm font-medium">{h.title}</span>',
    cut: '<span className="truncate text-sm font-medium">{h.title}</span>',
  },
  {
    what: "the Take list's item name wraps",
    file: "common/features/party-board/Inventory.tsx",
    shown: '<span className="min-w-0 flex-1 break-words">{s.row.name}</span>',
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
    shown: 'className="shrink-0 break-words text-xs text-destructive"',
    cut: "title={issue}",
  },
  {
    what: "the tray's error line wraps whole, no hover title",
    file: "common/features/dice-extras/TrayWindow.tsx",
    shown: 'className="shrink-0 break-words text-xs text-destructive"',
    cut: "title={error}",
  },
  {
    what: "the roll control's error line in the tray wraps whole, no hover title",
    file: "common/features/dice-extras/TrayWindow.tsx",
    shown: '<p className="shrink-0 break-words text-xs text-destructive" role="alert">',
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
