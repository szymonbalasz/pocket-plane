// FR-SHELL-184–188, -191, -194: the command registry, the generated Windows group, launch
// commands' `when` reasons and what they send, the characters / creatures each viewer gets,
// compendium rows, reserved keys and recent picks. Over a fake store and a real shell controller.
import { describe, expect, test } from "bun:test";
import { COMMANDS, PROVIDERS } from "../commands";
import { PREFS_KIND } from "../PreferencesWindow";
import { SHELL_TEST_KIND } from "../test-windows";
import { RESERVED_KEYS, SHORTCUT_TABLE, sameKey } from "./keys";
import { NO_FIGHT, NOT_CONNECTED, RULES_KIND, SP1_COMMANDS } from "./launch";
import { compendiumHits, linkToken, type Summary } from "./providers";
import { forClient, localEntries, rankLocal, whenOf } from "./rank";
import { pushRecent, RecentPicks, readRecent, recentKey } from "./storage";
import { GOBLIN_BOSS, MIRA, OWL, stateOf, THORN, testCtx } from "./test-env";
import type { PaletteCommand } from "./types";

const byId = (id: string) => COMMANDS.find((c) => c.id === id) as PaletteCommand;
const featureOff = () => false;

/** Every row of `ctx` as `group:id` for an empty-ish query over everything. */
function rowsOf(ctx: ReturnType<typeof testCtx>, q: string) {
  const cmds = forClient(COMMANDS, ctx, featureOff);
  const provs = forClient(PROVIDERS, ctx, featureOff);
  return rankLocal(localEntries(cmds, provs, ctx), q).flatMap((s) =>
    s.rows.map((r) => `${s.group}:${r.id}`),
  );
}

describe("command registry (FR-SHELL-184)", () => {
  test("FR-SHELL-184 registry: unique ids; unique keys per client; every key in §7's table for that client", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const client of ["dm", "player"] as const) {
      const mine = COMMANDS.filter((c) => c.clients.includes(client));
      const keys = mine.flatMap((c) => c.keys ?? []);
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          expect(`${keys[i]} ≠ ${keys[j]}: ${sameKey(keys[i] ?? "", keys[j] ?? "")}`).toBe(
            `${keys[i]} ≠ ${keys[j]}: false`,
          );
        }
      }
      for (const c of mine) {
        for (const k of c.keys ?? []) {
          expect(`${c.id} ${k}: ${SHORTCUT_TABLE[k]?.includes(client) ?? false}`).toBe(
            `${c.id} ${k}: true`,
          );
        }
      }
    }
    // Providers too: unique ids.
    const pids = PROVIDERS.map((p) => p.id);
    expect(new Set(pids).size).toBe(pids.length);
  });

  test("FR-SHELL-184 feature off hides entry and key: an entry with `feature` is left out of this client's list until the campaign switches it on (ruling 14)", () => {
    const gated: PaletteCommand = {
      id: "gem.test",
      title: "Award gems",
      group: "Commands",
      clients: ["dm"],
      feature: "gems",
      keys: ["G"],
      run: () => {},
    };
    const ctx = testCtx();
    const list = [...COMMANDS, gated];
    expect(forClient(list, ctx, () => false).some((c) => c.id === "gem.test")).toBe(false);
    expect(forClient(list, ctx, (k) => k === "gems").some((c) => c.id === "gem.test")).toBe(true);
    // Providers carry `feature?` the same way.
    const prov = { id: "p", group: "Rules" as const, clients: ["dm" as const], feature: "gems" };
    expect(forClient([prov], ctx, () => false)).toEqual([]);
  });

  test("FR-SHELL-191 no existing key reused: no registry key is a reserved key (Space, Escape, Ctrl+D, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, Enter + modifiers, Tab, arrows, Backspace / Delete; tool-local keys)", () => {
    for (const c of COMMANDS) {
      for (const k of c.keys ?? []) {
        for (const r of RESERVED_KEYS) {
          expect(`${c.id} ${k} vs ${r}: ${sameKey(k, r) || sameKey(r, k)}`).toBe(
            `${c.id} ${k} vs ${r}: false`,
          );
        }
      }
    }
    // Ctrl+Y (fog / tool redo) is reserved (ruling 12), and the table never assigns it.
    expect(RESERVED_KEYS).toContain("Ctrl+Y");
    expect(Object.keys(SHORTCUT_TABLE).some((k) => sameKey(k, "Ctrl+Y"))).toBe(false);
  });
});

describe("Windows group (FR-SHELL-185)", () => {
  test("FR-SHELL-185 windows from the registry: one row per launcher window + Preferences, both clients; test-mode windows only in test mode; Open → Go to once open", () => {
    for (const client of ["dm", "player"] as const) {
      const ctx = testCtx({ client });
      const windows = rowsOf(ctx, "")
        .concat(rowsOf(ctx, "o"))
        .filter((r) => r.startsWith("Windows:"));
      // The empty query lists Recent + Commands; a query lists windows.
      const all = rankLocal(
        localEntries(forClient(COMMANDS, ctx, featureOff), [], ctx),
        "window",
      ).flatMap((s) => s.rows.filter((r) => r.group === "Windows").map((r) => r.id));
      expect(new Set(all)).toEqual(
        new Set([
          "dice.log",
          "cbt.initiative",
          "dicex.tray",
          "char.sheet",
          "cmp.compendium",
          "party.board",
          "stats.board",
          PREFS_KIND,
        ]),
      );
      expect(windows.includes(`Windows:${SHELL_TEST_KIND}`)).toBe(false);
      const test = testCtx({ client, testMode: true });
      const withTest = rankLocal(localEntries([], [], test), "test").flatMap((s) =>
        s.rows.map((r) => r.id),
      );
      expect(withTest).toContain(SHELL_TEST_KIND);
    }
    // "Go to" once open (the hint), and a run opens with by: "user" (front only when open).
    const ctx = testCtx();
    const row = () =>
      rankLocal(localEntries([], [], ctx), "game log")
        .flatMap((s) => s.rows)
        .find((r) => r.id === "dice.log");
    expect(row()?.title).toBe("Open Game log");
    row()?.run();
    expect(stateOf(ctx, "dice.log")).toBe("open");
    expect(row()?.title).toBe("Go to Game log");
    const before = ctx.controller.store.getState().windows.find((w) => w.kind === "dice.log");
    row()?.run();
    const after = ctx.controller.store.getState().windows.find((w) => w.kind === "dice.log");
    // Seams S14: "Go to" fronts without moving.
    expect([after?.x, after?.y, after?.w, after?.h]).toEqual([
      before?.x,
      before?.y,
      before?.w,
      before?.h,
    ]);
  });

  test("FR-SHELL-185 window keys show on their window's row; R (Rules) stays hidden until SP2 registers `cmp.rules`", () => {
    const ctx = testCtx();
    const rows = rankLocal(localEntries(forClient(COMMANDS, ctx, featureOff), [], ctx), "log")
      .flatMap((s) => s.rows)
      .filter((r) => r.group === "Windows");
    expect(rows.find((r) => r.id === "dice.log")?.keys).toEqual(["L"]);
    expect(whenOf(byId("window.rules"), ctx)).toBe(false);
    const withRules = testCtx({ registryExtra: [RULES_KIND] });
    expect(whenOf(byId("window.rules"), withRules)).toBe(true);
  });
});

describe("launch commands (FR-SHELL-186)", () => {
  test("FR-SHELL-186 when reasons: no fight → Next / Previous turn disabled 'No fight started'; not live → every sending command 'Not connected'; a paused DM may still step and Resume", () => {
    const idle = testCtx();
    expect(whenOf(byId("cbt.next-turn"), idle)).toBe(NO_FIGHT);
    expect(whenOf(byId("cbt.prev-turn"), idle)).toBe(NO_FIGHT);
    expect(whenOf(byId("shell.resume"), idle)).toBe(false);
    expect(whenOf(byId("shell.pause"), idle)).toBe(true);
    const offline = testCtx({ started: true, live: false });
    for (const id of ["cbt.next-turn", "cbt.prev-turn", "shell.pause"]) {
      expect(whenOf(byId(id), offline)).toBe(NOT_CONNECTED);
    }
    // Local commands keep working offline.
    for (const id of ["shell.reset-layout", "shell.preferences", "shell.roll", "shell.shortcuts"]) {
      expect(whenOf(byId(id), offline)).toBe(true);
    }
    const paused = testCtx({ started: true, paused: true });
    expect(whenOf(byId("cbt.next-turn"), paused)).toBe(true);
    expect(whenOf(byId("shell.resume"), paused)).toBe(true);
    expect(whenOf(byId("shell.pause"), paused)).toBe(false);
    expect(whenOf(byId("shell.resume"), testCtx({ paused: true, live: false }))).toBe(
      NOT_CONNECTED,
    );
    // Players: no DM commands at all.
    const player = forClient(COMMANDS, testCtx({ client: "player" }), featureOff).map((c) => c.id);
    for (const id of [
      "cbt.next-turn",
      "cbt.prev-turn",
      "shell.pause",
      "shell.resume",
      "stats.awards",
    ]) {
      expect(player).not.toContain(id);
    }
  });

  test("FR-SHELL-186 Next turn sends cbt.nextTurn: the client's sender gets the Initiative button's intent and payload (the server checks it as today: a player's is `forbidden`, FR-CBT-14)", async () => {
    const ctx = testCtx({ started: true, result: { notRestored: [] } });
    await byId("cbt.next-turn").run(ctx);
    await byId("cbt.prev-turn").run(ctx);
    expect(ctx.sent).toEqual([
      {
        name: "cbt.nextTurn",
        payload: { encounterId: "enc-1", expectedRound: 1, expectedTurnId: "cb-mira" },
      },
      {
        name: "cbt.prevTurn",
        payload: { encounterId: "enc-1", expectedRound: 1, expectedTurnId: "cb-mira" },
      },
    ]);
    const paused = testCtx({ paused: true });
    await byId("shell.resume").run(paused);
    expect(paused.sent).toEqual([{ name: "camp.resume", payload: {} }]);
  });

  test('FR-SHELL-186 Reset layout, Preferences, Show awards and the window keys go through the shell (`by: "user"`)', () => {
    const ctx = testCtx();
    byId("shell.reset-layout").run(ctx);
    byId("shell.preferences").run(ctx);
    byId("stats.awards").run(ctx);
    byId("window.log").run(ctx);
    expect(ctx.calls).toEqual([
      "reset",
      `open:${PREFS_KIND}`,
      "open:stats.board",
      "toggle:dice.log",
    ]);
    // C: the DM (or several characters) → the palette on `@`; one own character → its sheet.
    const dm = testCtx();
    byId("window.sheet").run(dm);
    expect(dm.calls).toEqual(["palette:@"]);
    const p1 = testCtx({ client: "player" });
    byId("window.sheet").run(p1);
    expect(p1.calls).toEqual(["toggle:char.sheet"]);
    expect(SP1_COMMANDS.every((c) => COMMANDS.includes(c))).toBe(true);
  });
});

describe("characters and creatures (FR-SHELL-187)", () => {
  test("FR-SHELL-187 player sees own only: player 1 gets Mira and her owl, not Thorn, no Creatures group; the DM gets every character, the pet and the custom creature", () => {
    const p1 = rowsOf(testCtx({ client: "player" }), "@");
    expect(p1).toEqual([`Characters:${MIRA}`, `Characters:${OWL}`]);
    const p2 = rowsOf(testCtx({ client: "player", playerId: "p2" }), "@");
    expect(p2).toEqual([`Characters:${THORN}`]);
    const dm = rowsOf(testCtx(), "@");
    expect(dm).toEqual([
      `Characters:${MIRA}`,
      `Characters:${OWL}`,
      `Characters:${THORN}`,
      `Creatures:${GOBLIN_BOSS}`,
    ]);
    // A pick opens the sheet / the card through the shell.
    const ctx = testCtx({ client: "player" });
    const rows = rankLocal(
      localEntries([], forClient(PROVIDERS, ctx, featureOff), ctx),
      "@mira",
    ).flatMap((s) => s.rows);
    rows[0]?.run();
    expect(ctx.calls).toEqual(["open:char.sheet"]);
  });
});

describe("compendium rows (FR-SHELL-188)", () => {
  const summary = (id: string, kind: string, name: string, extra: Partial<Summary> = {}) => ({
    id,
    kind,
    name,
    line: `${kind} line`,
    sourceLabel: "SRD 5.1",
    ...extra,
  });

  test("FR-SHELL-188 player compendium rows: rows are what the server returned for the viewer (FR-CMP-14: no monster for a player), rules under Rules, ≤ 8 each, server order kept", () => {
    // A player's answer never holds monsters (server-side, FR-CMP-14); the palette adds none.
    const playerAnswer = [
      summary("e1", "item", "Goblin Mask"),
      summary("e2", "spell", "Goblin Ward", { sourceLabel: "Homebrew" }),
    ];
    const rows = compendiumHits(playerAnswer);
    expect(rows.map((r) => [r.group, r.id, r.kind])).toEqual([
      ["Compendium", "e1", "item"],
      ["Compendium", "e2", "spell"],
    ]);
    expect(rows.some((r) => r.kind === "monster")).toBe(false);
    expect(rows[1]?.hint).toBe("spell line · Homebrew");
    const many = Array.from({ length: 12 }, (_, i) =>
      summary(`r${i}`, i % 2 ? "rule" : "item", `X${i}`),
    );
    // Rule entries are SP2's Rules provider's (`kind=rule`), never Compendium rows.
    const hits = compendiumHits(many);
    expect(hits.filter((h) => h.group === "Rules")).toEqual([]);
    expect(hits.filter((h) => h.group === "Compendium")).toHaveLength(6);
    expect(
      compendiumHits(Array.from({ length: 20 }, (_, i) => summary(`i${i}`, "item", `I${i}`))),
    ).toHaveLength(8);
    // The player's credential is the page's link token.
    expect(linkToken("/p/abc%20d")).toBe("abc d");
    expect(linkToken("/")).toBeNull();
  });

  test("FR-SHELL-188 a compendium row opens cmp.compendium on its entry (an entryless monster on its definition)", () => {
    const ctx = testCtx();
    const [row] = compendiumHits([
      summary("def-1", "monster", "Goblin", { definitionId: "def-1" }),
    ]);
    row?.run(ctx);
    expect(ctx.calls).toEqual(["open:cmp.compendium"]);
  });
});

describe("recent picks (FR-SHELL-194)", () => {
  test("FR-SHELL-194 recent picks parse: per campaign and owner key, ≤ 8, newest first, deduplicated, zod-parsed (a bad entry → none)", () => {
    expect(recentKey("c1", { role: "dm" })).toBe("pp.palette.v1.c1.dm");
    expect(recentKey("c1", { playerId: "p1" })).toBe("pp.palette.v1.c1.p1");
    const data = new Map<string, string>();
    const backend = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    const key = "pp.palette.v1.c1.dm";
    for (let i = 0; i < 10; i++) pushRecent(key, `c:cmd-${i}`, backend);
    pushRecent(key, "c:cmd-3", backend);
    const list = readRecent(key, backend);
    expect(list).toHaveLength(8);
    expect(list[0]).toBe("c:cmd-3");
    expect(new Set(list).size).toBe(8);
    expect(JSON.stringify(list).length).toBeLessThan(400);
    data.set(key, "{oops");
    expect(readRecent(key, backend)).toEqual([]);
    data.set(key, JSON.stringify([1, 2]));
    expect(readRecent(key, backend)).toEqual([]);
    expect(RecentPicks.parse(Array.from({ length: 12 }, (_, i) => `w:${i}`))).toHaveLength(8);
    // Unknown keys drop when the list resolves (a deleted character, a gone window).
    const ctx = testCtx();
    const recent = rankLocal(localEntries(forClient(COMMANDS, ctx, featureOff), [], ctx), "", [
      "c:gone",
      "w:dice.log",
      "c:shell.reset-layout",
    ]);
    expect(recent[0]?.group).toBe("Recent");
    expect(recent[0]?.rows.map((r) => r.id)).toEqual(["dice.log", "shell.reset-layout"]);
  });
});
