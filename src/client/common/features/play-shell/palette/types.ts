// The command registry's contract (FR-SHELL-184, -199, ADR-0067): commands and search providers,
// what they get (`CommandCtx`), and the palette's rows. Client code only: never sent or stored.
import type { RecordStore } from "@shared/protocol/store";
import type { ComponentType } from "react";
import type { Windows } from "../manager";
import type { ShellClient, WindowRegistry } from "../registry";
import type { KeySpec } from "./keys";

/** FR-SHELL-182: the palette's groups, in this order (Recent only for the empty query). */
export const GROUPS = [
  "Commands",
  "Windows",
  "Characters",
  "Creatures",
  "Rules",
  "Compendium",
] as const;
export type PaletteGroup = (typeof GROUPS)[number] | "Recent";

/** FR-SHELL-183: rows per group. */
export const GROUP_MAX = 8;

/** What a command may do: the shell's window actions (all `by: "user"`, seams S3). */
export interface CommandShell {
  /** Open, restore or front (a remembered window reopens exactly; "Go to" never moves it, S14). */
  openWindow(kind: string): void;
  /** Front an open window. */
  focusWindow(kind: string): void;
  /** FR-SHELL-189: closed → open; behind → front; the focused front window → minimised. */
  toggleWindow(kind: string): void;
  /** FR-SHELL-153's Reset layout (`useResetLayout`, FR-SHELL-165). */
  resetLayout(): void;
}

/** FR-SHELL-184: what `when` / `run` / a provider read. A snapshot of the page at call time. */
export interface CommandCtx {
  client: ShellClient;
  store: RecordStore;
  /** The connection is `live` (commands that send are disabled otherwise). */
  live: boolean;
  /** This client's window registry and layout (Windows group, window keys). */
  registry: WindowRegistry;
  windows: Windows;
  /** Kinds rendered now (registered + available). */
  available: ReadonlySet<string>;
  shell: CommandShell;
  /**
   * The client's intent sender: an existing intent, checked by the server as today. Resolves to
   * the ack's result, or undefined after a rejection (toasted).
   */
  send<R = unknown>(name: string, payload: unknown): Promise<R | undefined>;
  /** Open the palette on `prefix` (`>` commands, `@` characters). */
  openPalette(prefix?: string): void;
  /** The shortcuts sheet (FR-SHELL-192). */
  openShortcuts(): void;
}

/** `true` = shown and runs; a string = shown disabled with that reason; `false` = hidden. */
export type When = boolean | string;

export interface PaletteCommand {
  /** Unique; `data-record-id` of its row and sheet line; recent picks store it. */
  id: string;
  title: string;
  keywords?: readonly string[];
  group: "Commands" | "Windows";
  clients: readonly ShellClient[];
  /** A campaign feature switch (ADR-0058): while off, hidden and its keys do nothing (ruling 14). */
  feature?: string;
  /** From play-shell §7's table only (`SHORTCUT_TABLE`, test). */
  keys?: readonly KeySpec[];
  /**
   * A window key (Windows group): its row is the window's generated row (FR-SHELL-185), which
   * shows the key; no row of its own.
   */
  window?: string;
  /** Not a palette row (the palette chord itself); still in the sheet. */
  paletteHidden?: true;
  when?(ctx: CommandCtx): When;
  run(ctx: CommandCtx): void | Promise<void>;
}

/** A row a provider offers. Local items are ranked by the palette; server ones keep their order. */
export interface PaletteItem {
  /** `data-record-id`: record id / entry id. */
  id: string;
  title: string;
  keywords?: readonly string[];
  /** Muted hint after the title ("Character", "Mira's pet", the compendium line). */
  hint?: string;
  /** Extra `data-kind` (compendium entry kind). */
  kind?: string;
  icon?: ComponentType<{ className?: string }>;
  run(ctx: CommandCtx): void;
}

/**
 * FR-SHELL-199: a search provider for a group. `items` = local rows from the synced store (ranked
 * with the shared matcher, never wait); `search` = server rows for a non-empty query (debounced,
 * shown under the group's heading when they arrive). Either or both.
 */
export interface SearchProvider {
  id: string;
  group: Exclude<PaletteGroup, "Recent" | "Commands" | "Windows">;
  clients: readonly ShellClient[];
  feature?: string;
  /** Also listed for `@` (characters and creatures). */
  at?: true;
  items?(ctx: CommandCtx): readonly PaletteItem[];
  search?(q: string, ctx: CommandCtx, signal: AbortSignal): Promise<readonly SearchHit[]>;
}

/** A server row and the group it goes under (a provider may fill two, e.g. Rules + Compendium). */
export interface SearchHit extends PaletteItem {
  group: Exclude<PaletteGroup, "Recent" | "Commands" | "Windows">;
}
