// FR-SHELL-182, -183: groups, prefixes and ranking with the shared matcher; local rows never wait
// for the server's, which come after them under Rules / Compendium.
import { describe, expect, test } from "bun:test";
import { COMMANDS, PROVIDERS } from "../commands";
import { compendiumHits } from "./providers";
import { forClient, localEntries, parseQuery, rankLocal, TOTAL_MAX, withServer } from "./rank";
import { testCtx } from "./test-env";
import { GROUP_MAX, type PaletteItem, type SearchProvider } from "./types";

const off = () => false;

function setup(o: Parameters<typeof testCtx>[0] = {}) {
  const ctx = testCtx(o);
  const entries = localEntries(forClient(COMMANDS, ctx, off), forClient(PROVIDERS, ctx, off), ctx);
  const rank = (q: string, recent: string[] = []) => rankLocal(entries, q, recent);
  const groups = (q: string) => rank(q).map((s) => s.group);
  const ids = (q: string) => rank(q).flatMap((s) => s.rows.map((r) => r.id));
  return { ctx, entries, rank, groups, ids };
}

describe("palette (FR-SHELL-182, -183)", () => {
  test("FR-SHELL-182 prefixes: `>` = commands only, `@` = characters and creatures only; empty → Recent then Commands", () => {
    expect(parseQuery("> reset")).toEqual({ mode: "commands", q: "reset" });
    expect(parseQuery("@mira")).toEqual({ mode: "at", q: "mira" });
    expect(parseQuery("  init ")).toEqual({ mode: "all", q: "init" });
    const p = setup({ started: true });
    expect(p.groups("> reset")).toEqual(["Commands"]);
    expect(p.ids("> reset")).toEqual(["shell.reset-layout"]);
    // `>` alone lists every command (the palette chord itself is no row).
    const all = p.ids(">");
    expect(all).toContain("cbt.next-turn");
    expect(all).not.toContain("shell.palette");
    expect(p.groups("@")).toEqual(["Characters", "Creatures"]);
    expect(p.groups("@ mira")).toEqual(["Characters"]);
    // "@" never lists commands or windows even when they'd match.
    expect(p.groups("@ log")).toEqual([]);
    // Empty: Recent (when there is any), then Commands.
    expect(p.groups("")).toEqual(["Commands"]);
    expect(p.rank("", ["w:dice.log"]).map((s) => s.group)).toEqual(["Recent", "Commands"]);
    // A recent command shows once: in Recent, not again under Commands.
    const twice = p.rank("", ["c:shell.reset-layout", "c:shell.pause"]);
    expect(twice[0]?.rows.map((r) => r.id)).toEqual(["shell.reset-layout", "shell.pause"]);
    expect(twice[1]?.rows.map((r) => r.id)).not.toContain("shell.reset-layout");
    expect(twice[1]?.rows.map((r) => r.id)).not.toContain("shell.pause");
    expect(p.rank("")[0]?.rows.length).toBeLessThanOrEqual(GROUP_MAX);
    // Players: no Creatures group.
    expect(setup({ client: "player" }).groups("@")).toEqual(["Characters"]);
  });

  test('FR-SHELL-183 tiers and group order: best tier first ("init" → Windows Initiative first), then group order, then shorter title; ≤ 8 a group, ≤ 40 in all; local rows before late compendium rows', () => {
    const p = setup({ started: true });
    // P1: "init" → the Initiative window is the first row.
    expect(p.rank("init")[0]?.group).toBe("Windows");
    expect(p.rank("init")[0]?.rows[0]?.id).toBe("cbt.initiative");
    // Same tier in two groups: group order (Commands before Windows). "Pre" starts "Preferences"
    // (command) and "Preferences" (window), and "Previous turn".
    const pre = p.rank("pre");
    expect(pre.map((s) => s.group)).toEqual(["Commands", "Windows"]);
    // Inside a group: tier, then the shorter title ("Preferences" before "Previous turn").
    expect(pre[0]?.rows.map((r) => r.id)).toEqual(["shell.preferences", "cbt.prev-turn"]);
    // Keywords match (text tier): "hotkeys" → Keyboard shortcuts.
    expect(p.ids("hotkeys")).toEqual(["shell.shortcuts"]);
    // A name match beats a keyword-only match across groups.
    const turn = p.rank("turn");
    expect(turn[0]?.rows[0]?.title).toMatch(/turn/i);
    // Caps: a provider with 30 matching rows shows 8; the total stays ≤ 40.
    const many: SearchProvider = {
      id: "many",
      group: "Creatures",
      clients: ["dm"],
      items: () =>
        Array.from(
          { length: 30 },
          (_, i): PaletteItem => ({ id: `m${i}`, title: `Goblin ${i}`, run: () => {} }),
        ),
    };
    const ctx = testCtx();
    const big = rankLocal(localEntries([], [many], ctx), "goblin");
    expect(big[0]?.rows).toHaveLength(GROUP_MAX);
    // Late server rows: appended after every local section, never reordering them.
    const local = p.rank("goblin");
    const hits = compendiumHits([
      { id: "e1", kind: "rule", name: "Goblin rule", line: "", sourceLabel: "SRD 5.1" },
      { id: "e2", kind: "monster", name: "Goblin", line: "", sourceLabel: "SRD 5.1" },
    ]);
    const merged = withServer(local, hits, p.ctx);
    expect(merged.slice(0, local.length)).toEqual(local);
    expect(merged.slice(local.length).map((s) => s.group)).toEqual(["Rules", "Compendium"]);
    const flood = withServer(
      big,
      compendiumHits(
        Array.from({ length: 50 }, (_, i) => ({
          id: `x${i}`,
          kind: i % 2 ? "rule" : "item",
          name: `X${i}`,
          line: "",
          sourceLabel: "SRD 5.1",
        })),
      ),
      ctx,
    );
    expect(flood.flatMap((s) => s.rows).length).toBeLessThanOrEqual(TOTAL_MAX);
  });
});
