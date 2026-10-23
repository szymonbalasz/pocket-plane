// Palette rows and ranking (FR-SHELL-182, -183, -185). Local rows (commands, windows, characters,
// creatures) match with the shared matcher (`@shared/search/match` `searchTier` over title +
// keywords), ranked by tier, then group order, then shorter title; ≤ 8 a group, ≤ 40 in all.
// Server rows (Rules, Compendium) keep the server's order and come after the local groups, so a
// late answer never moves what is already shown. Pure.
import {
  type FoldedName,
  foldName,
  queryWords,
  type SearchTier,
  searchTier,
  textWordsOf,
} from "@shared/search/match";
import type { ComponentType } from "react";
import { PREFS_KIND } from "../PreferencesWindow";
import type { KeySpec } from "./keys";
import {
  type CommandCtx,
  GROUP_MAX,
  GROUPS,
  type PaletteCommand,
  type PaletteGroup,
  type PaletteItem,
  type SearchHit,
  type SearchProvider,
  type When,
} from "./types";

/** FR-SHELL-183: rows in all. */
export const TOTAL_MAX = 40;

export interface Row {
  /** Recent-picks key: `c:<command id>`, `w:<kind>`, `i:<provider>:<id>`; server rows: `s:<id>`. */
  key: string;
  /** `data-record-id`: command id / window kind / record id. */
  id: string;
  /** `data-value`. */
  group: PaletteGroup;
  title: string;
  hint?: string;
  /** Compendium entry kind (`data-kind`). */
  kind?: string;
  keys?: readonly KeySpec[];
  /** Shown, not runnable (FR-SHELL-186). */
  disabled?: string;
  icon?: ComponentType<{ className?: string }>;
  run(): void;
}

/** A local row prepared for matching (once per store / layout change, not per keystroke). */
export interface LocalEntry {
  row: Row;
  /** What the query matches: the title (a window's own title, without "Open" / "Go to"). */
  label: string;
  name: FoldedName;
  text: readonly string[];
  /** Index in `GROUPS`. */
  order: number;
}

export type Mode = "all" | "commands" | "at";

/** FR-SHELL-182: `>` = commands only; `@` = characters and creatures only. */
export function parseQuery(input: string): { mode: Mode; q: string } {
  const t = input.trimStart();
  if (t.startsWith(">")) return { mode: "commands", q: t.slice(1).trim() };
  if (t.startsWith("@")) return { mode: "at", q: t.slice(1).trim() };
  return { mode: "all", q: input.trim() };
}

/** `when`, guarded: a throwing predicate hides the entry. */
export function whenOf(c: Pick<PaletteCommand, "id" | "when">, ctx: CommandCtx): When {
  try {
    return c.when ? c.when(ctx) : true;
  } catch (err) {
    console.warn(`command ${c.id}: when() threw`, err);
    return false;
  }
}

/** Entries for this client whose campaign feature is on (ADR-0058, ruling 14). */
export function forClient<T extends { clients: readonly string[]; feature?: string }>(
  list: readonly T[],
  ctx: Pick<CommandCtx, "client" | "store">,
  featureOn: (key: string) => boolean,
): T[] {
  return list.filter((e) => e.clients.includes(ctx.client) && (!e.feature || featureOn(e.feature)));
}

const groupIndex = (g: PaletteGroup) => GROUPS.indexOf(g as (typeof GROUPS)[number]);

function entry(row: Row, keywords: readonly string[] = [], label = row.title): LocalEntry {
  return {
    row,
    label,
    name: foldName(label),
    text: textWordsOf(keywords.join(" ")),
    order: groupIndex(row.group),
  };
}

/** Command rows (Commands group; window keys show on their window's row). */
function commandEntries(commands: readonly PaletteCommand[], ctx: CommandCtx): LocalEntry[] {
  const out: LocalEntry[] = [];
  for (const c of commands) {
    if (c.paletteHidden || c.window) continue;
    const w = whenOf(c, ctx);
    if (w === false) continue;
    out.push(
      entry(
        {
          key: `c:${c.id}`,
          id: c.id,
          group: c.group,
          title: c.title,
          hint: "Command",
          keys: c.keys,
          disabled: typeof w === "string" ? w : undefined,
          run: () => void c.run(ctx),
        },
        c.keywords,
      ),
    );
  }
  return out;
}

/**
 * FR-SHELL-185: one row per window type of this client with a launcher entry, plus Preferences;
 * "Open ‹title›", or "Go to ‹title›" when it is open or minimised (front; minimised → restored).
 * Matched on the title and launcher label. A window key's chip shows on its row.
 */
function windowEntries(commands: readonly PaletteCommand[], ctx: CommandCtx): LocalEntry[] {
  const keyOf = new Map<string, readonly KeySpec[]>();
  for (const c of commands) {
    if (c.window && c.keys && whenOf(c, ctx) === true) keyOf.set(c.window, c.keys);
  }
  const out: LocalEntry[] = [];
  for (const def of ctx.registry.defs) {
    if (!(def.launcher || def.kind === PREFS_KIND) || !ctx.available.has(def.kind)) continue;
    const state = ctx.windows.find((w) => w.kind === def.kind)?.state ?? "closed";
    const verb = state === "closed" ? "Open" : "Go to";
    const e = entry(
      {
        key: `w:${def.kind}`,
        id: def.kind,
        group: "Windows",
        title: `${verb} ${def.title}`,
        hint: "Window",
        keys: keyOf.get(def.kind),
        run: () => ctx.shell.openWindow(def.kind),
      },
      ["window", verb, def.launcher?.label ?? ""],
      def.title,
    );
    out.push(e);
  }
  return out;
}

/** Provider rows of a local group. */
function providerEntries(providers: readonly SearchProvider[], ctx: CommandCtx): LocalEntry[] {
  const out: LocalEntry[] = [];
  for (const p of providers) {
    let items: readonly PaletteItem[] = [];
    try {
      items = p.items?.(ctx) ?? [];
    } catch (err) {
      console.warn(`palette provider ${p.id}: items() threw`, err);
    }
    for (const it of items) {
      out.push(
        entry(
          {
            key: `i:${p.id}:${it.id}`,
            id: it.id,
            group: p.group,
            title: it.title,
            hint: it.hint,
            kind: it.kind,
            icon: it.icon,
            run: () => it.run(ctx),
          },
          it.keywords,
        ),
      );
    }
  }
  return out;
}

/** Every local row for `ctx`, prepared for matching. */
export function localEntries(
  commands: readonly PaletteCommand[],
  providers: readonly SearchProvider[],
  ctx: CommandCtx,
): LocalEntry[] {
  return [
    ...commandEntries(commands, ctx),
    ...windowEntries(commands, ctx),
    ...providerEntries(providers, ctx),
  ];
}

const AT_GROUPS = new Set<PaletteGroup>(["Characters", "Creatures"]);

const inMode = (e: LocalEntry, mode: Mode) =>
  mode === "all" || (mode === "commands" ? e.row.group === "Commands" : AT_GROUPS.has(e.row.group));

export interface Section {
  group: PaletteGroup;
  rows: Row[];
}

interface Hit {
  tier: SearchTier;
  label: string;
  row: Row;
}

/** Rows of one group, best first: tier, shorter title, then title. */
function byTier(a: Hit, b: Hit) {
  return a.tier - b.tier || a.label.length - b.label.length || a.label.localeCompare(b.label);
}

/**
 * FR-SHELL-183: the local sections for a query. Empty query → Recent (resolved, unknown keys
 * dropped), then Commands (`>` alone: every command); `@` alone → every character and creature.
 */
export function rankLocal(
  entries: readonly LocalEntry[],
  input: string,
  recent: readonly string[] = [],
): Section[] {
  const { mode, q } = parseQuery(input);
  const words = queryWords(q);
  const pool = entries.filter((e) => inMode(e, mode));
  if (words.length === 0) {
    const out: Section[] = [];
    if (mode === "all") {
      const byKey = new Map(pool.map((e) => [e.row.key, e.row]));
      const rows = recent.flatMap((k) => byKey.get(k) ?? []).slice(0, GROUP_MAX);
      if (rows.length > 0) out.push({ group: "Recent", rows });
    }
    const groups = mode === "at" ? (["Characters", "Creatures"] as const) : (["Commands"] as const);
    // `>` and `@` alone list their whole groups, up to the total.
    const cap = mode === "all" ? GROUP_MAX : TOTAL_MAX;
    for (const g of groups) {
      const rows = pool
        .filter((e) => e.row.group === g)
        .map((e) => e.row)
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, cap);
      if (rows.length > 0) out.push({ group: g, rows });
    }
    return capTotal(out);
  }
  const hits = new Map<PaletteGroup, Hit[]>();
  for (const e of pool) {
    const tier = searchTier(e.name, e.text, words);
    if (tier === null) continue;
    const list = hits.get(e.row.group) ?? [];
    list.push({ tier, label: e.label, row: e.row });
    hits.set(e.row.group, list);
  }
  const sections = [...hits].map(([group, list]) => {
    list.sort(byTier);
    return { group, best: list[0]?.tier ?? 9, rows: list.slice(0, GROUP_MAX).map((h) => h.row) };
  });
  sections.sort((a, b) => a.best - b.best || groupIndex(a.group) - groupIndex(b.group));
  return capTotal(sections.map(({ group, rows }) => ({ group, rows })));
}

/** Server rows under their groups (Rules, then Compendium), after the local sections. */
export function withServer(local: readonly Section[], hits: readonly SearchHit[], ctx: CommandCtx) {
  const out: Section[] = [...local];
  for (const g of GROUPS) {
    const rows = hits
      .filter((h) => h.group === g)
      .map(
        (h): Row => ({
          key: `s:${h.id}`,
          id: h.id,
          group: g,
          title: h.title,
          hint: h.hint,
          kind: h.kind,
          icon: h.icon,
          run: () => h.run(ctx),
        }),
      );
    if (rows.length > 0) out.push({ group: g, rows: rows.slice(0, GROUP_MAX) });
  }
  return capTotal(out);
}

function capTotal(sections: readonly Section[]): Section[] {
  let left = TOTAL_MAX;
  const out: Section[] = [];
  for (const s of sections) {
    if (left <= 0) break;
    const rows = s.rows.slice(0, left);
    left -= rows.length;
    out.push({ group: s.group, rows });
  }
  return out;
}

/** The rows in display order (↑ / ↓ move through these). */
export const flatRows = (sections: readonly Section[]): Row[] => sections.flatMap((s) => s.rows);
