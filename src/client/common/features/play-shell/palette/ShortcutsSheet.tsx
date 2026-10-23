// The shortcuts sheet (FR-SHELL-192): `?` or "Keyboard shortcuts" opens a Dialog listing this
// client's shortcuts, generated from the registry (keys, title, a disabled reason; "Off" while
// single keys are off, FR-SHELL-193), then the fixed "Map and rolls" keys (FR-SHELL-191). Two
// columns from 480 px wide, one below. Escape closes.

import { XIcon } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useStore } from "zustand";
import type { PaletteEnv } from "./context";
import { fixedKeysFor, isSingleKey } from "./keys";
import { KeyChips, useFocusReturn } from "./Palette";
import { whenOf } from "./rank";
import { closeShortcuts } from "./state";
import { keysSetting } from "./storage";
import type { CommandCtx, PaletteCommand } from "./types";

export interface SheetRow {
  id: string;
  title: string;
  keys: readonly string[];
  /** "Off" (single keys off) or the command's disabled reason. */
  note?: string;
}

/** The registry's lines for this client (hidden commands left out), in registry order. */
export function sheetRows(
  commands: readonly PaletteCommand[],
  ctx: CommandCtx,
  singleKey: boolean,
): SheetRow[] {
  const out: SheetRow[] = [];
  for (const c of commands) {
    if (!c.keys || c.keys.length === 0) continue;
    const w = whenOf(c, ctx);
    if (w === false) continue;
    // A window key reads as its window's title (the registry's, e.g. "Party Manager").
    const title = (c.window && ctx.registry.get(c.window)?.title) || c.title;
    const off = !singleKey && c.keys.every(isSingleKey);
    out.push({
      id: c.id,
      title,
      keys: c.keys,
      note: off ? "Off" : typeof w === "string" ? w : undefined,
    });
  }
  return out;
}

export function ShortcutsList({
  rows,
  mac,
  client,
}: {
  rows: readonly SheetRow[];
  mac: boolean;
  client: "dm" | "player";
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ul className="grid grid-cols-1 gap-x-6 gap-y-1 min-[480px]:grid-cols-2">
        {rows.map((r) => (
          <li
            key={r.id}
            data-testid="ui-shortcuts-row"
            data-record-id={r.id}
            data-state={r.note === "Off" ? "off" : r.note ? "disabled" : "on"}
            className="flex items-center justify-between gap-2"
          >
            <span className="min-w-0 truncate">
              {r.title}
              {r.note && <span className="ml-1.5 text-xs text-muted-foreground">{r.note}</span>}
            </span>
            <KeyChips keys={r.keys} mac={mac} />
          </li>
        ))}
      </ul>
      <div>
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">Map and rolls</h3>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 min-[480px]:grid-cols-2">
          {fixedKeysFor(client).map((f) => (
            <li key={f.keys} className="flex items-center justify-between gap-2">
              <span className="min-w-0 text-muted-foreground">{f.title}</span>
              <kbd className="shrink-0 rounded border bg-muted px-1.5 font-mono text-[11px] leading-5 text-muted-foreground">
                {f.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ShortcutsSheet({ env, mac }: { env: PaletteEnv; mac: boolean }) {
  const singleKey = useStore(keysSetting, (s) => s.singleKey);
  const rows = sheetRows(env.commands, env.ctx, singleKey);
  const returnFocus = useFocusReturn();
  return (
    <D.Root open onOpenChange={(o) => !o && closeShortcuts()}>
      <D.Overlay className="pointer-events-auto fixed inset-0 bg-black/40" />
      <D.Content
        data-testid="ui-shortcuts"
        data-palette=""
        aria-describedby={undefined}
        onCloseAutoFocus={returnFocus}
        className="pointer-events-auto fixed top-[12vh] left-1/2 flex max-h-[76vh] w-[640px] max-w-[90vw] -translate-x-1/2 flex-col gap-3 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg outline-none"
      >
        <D.Title className="text-base font-semibold">Keyboard shortcuts</D.Title>
        <ShortcutsList rows={rows} mac={mac} client={env.ctx.client} />
        <D.Close
          className="absolute top-4 right-4 opacity-70 hover:opacity-100"
          aria-label="Close"
          data-testid="ui-shortcuts-close"
        >
          <XIcon className="size-4" />
        </D.Close>
      </D.Content>
    </D.Root>
  );
}
