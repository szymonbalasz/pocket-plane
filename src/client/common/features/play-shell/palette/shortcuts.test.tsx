// FR-SHELL-180, -181, -189–193, -195, -196: the dispatcher over fake key events and fake targets
// (no DOM in bun test: a target is a tiny element model with `closest`), window keys through a
// real shell controller, the sheet's rows, the single-key switch, the top-bar button's slot and
// the palette's states as static renders.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { COMMANDS } from "../commands";
import { fitLauncher, fittedBarWidth, LAUNCHER_GUTTER, launcherMetrics } from "../launcher-fit";
import { OVERLAYS, overlaysFor } from "../overlays";
import { TOP_BAR_ITEMS, topBarItemsFor, topBarItemWidth } from "../top-bar-items";
import { type DispatchEnv, decide, type KeyEventLike, modalDialogOpen } from "./dispatch";
import { PaletteList } from "./Palette";
import { forClient, localEntries, rankLocal, whenOf } from "./rank";
import { ShortcutsList, sheetRows } from "./ShortcutsSheet";
import { closePalette, openPalette, paletteUi } from "./state";
import { KEYS_KEY, keysSetting, readKeys, setSingleKey } from "./storage";
import { PALETTE_BUTTON_W, paletteTip } from "./TopBarButton";
import { stateOf, testCtx } from "./test-env";

// ---- a tiny element model: tag, attributes, parent; `closest` over the selectors we use ----

interface FakeEl {
  tag: string;
  attrs: Record<string, string>;
  parent: FakeEl | null;
  isContentEditable?: boolean;
  closest(selector: string): FakeEl | null;
}

function matchesOne(el: FakeEl, sel: string): boolean {
  const m = /^([a-z]*)((?:\[[^\]]+\])*)((?::not\(\[[^\]]+\]\))*)$/.exec(sel.trim());
  if (!m) return false;
  const [, tag, attrs, nots] = m;
  if (tag && el.tag !== tag) return false;
  const attrOk = (a: string) => {
    const am = /^([\w-]+)(?:="([^"]*)")?$/.exec(a);
    if (!am?.[1]) return false;
    const v = el.attrs[am[1]];
    return am[2] === undefined ? v !== undefined : v === am[2];
  };
  for (const a of attrs?.match(/\[[^\]]+\]/g) ?? []) if (!attrOk(a.slice(1, -1))) return false;
  for (const n of nots?.match(/\[[^\]]+\]/g) ?? []) if (attrOk(n.slice(1, -1))) return false;
  return true;
}

function el(tag: string, attrs: Record<string, string> = {}, parent: FakeEl | null = null): FakeEl {
  const self: FakeEl = {
    tag,
    attrs,
    parent,
    isContentEditable: attrs.contenteditable === "true",
    closest(selector) {
      const list = selector.split(",").map((s) => s.trim());
      for (let n: FakeEl | null = self; n; n = n.parent) {
        if (list.some((s) => matchesOne(n as FakeEl, s))) return n;
      }
      return null;
    },
  };
  return self;
}

const page = el("div", { "data-testid": "ui-play-page" });
const map = el("div", { role: "application" }, page);
const windowBody = el("div", { "data-shell-zone": "window" }, page);
const button = el("button", {}, windowBody);
const rollBar = el("input", { type: "text", "data-testid": "dice-roll-expression" }, windowBody);
const textarea = el("textarea", {}, windowBody);
const select = el("select", {}, windowBody);
const editable = el("div", { contenteditable: "true" }, windowBody);
const menu = el("div", { role: "menu" }, page);
const menuItem = el("div", { role: "menuitem" }, menu);
const checkbox = el("input", { type: "checkbox" }, windowBody);

const key = (k: string, o: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  target: map as unknown as EventTarget,
  ...o,
});
const at = (t: FakeEl) => t as unknown as EventTarget;

function env(ctx = testCtx({ started: true }), o: Partial<DispatchEnv> = {}): DispatchEnv {
  return {
    commands: forClient(COMMANDS, ctx, () => false),
    mac: false,
    blocked: false,
    modalOpen: false,
    singleKey: true,
    when: (c) => whenOf(c, ctx),
    ...o,
  };
}

const outcome = (e: KeyEventLike, en: DispatchEnv) => {
  const d = decide(e, en);
  return d ? `${d.command.id}:${d.outcome}` : null;
};

describe("dispatcher (FR-SHELL-180, -190)", () => {
  test("FR-SHELL-180 opens from anywhere: Ctrl+K (⌘K on macOS) on the map, a window body, a button and the roll-bar input runs the palette chord; not over a modal dialog", () => {
    const e = env();
    for (const t of [map, windowBody, button, rollBar, textarea, editable]) {
      expect(outcome(key("k", { ctrlKey: true, target: at(t) }), e)).toBe("shell.palette:ran");
    }
    expect(outcome(key("K", { ctrlKey: true, shiftKey: false }), e)).toBe("shell.palette:ran");
    expect(outcome(key("k", { metaKey: true }), { ...e, mac: true })).toBe("shell.palette:ran");
    // ⌘K is not the chord off macOS, Ctrl+K not on it (exact modifiers).
    expect(outcome(key("k", { metaKey: true }), e)).toBeNull();
    expect(outcome(key("k", { ctrlKey: true }), { ...e, mac: true })).toBeNull();
    expect(outcome(key("k", { ctrlKey: true }), { ...e, modalOpen: true })).toBe(
      "shell.palette:disabled",
    );
    // The chord toggles the palette.
    closePalette();
    const ctx = testCtx();
    const chord = COMMANDS.find((c) => c.id === "shell.palette");
    chord?.run(ctx);
    expect(paletteUi.getState().open).toBe(true);
    chord?.run(ctx);
    expect(paletteUi.getState().open).toBe(false);
  });

  test("FR-SHELL-180 a modal dialog / alert dialog other than the palette's is open (Radix modal: body pointer events off)", () => {
    const doc = (open: string[], pointer = "none") => ({
      body: { style: { pointerEvents: pointer } } as unknown as HTMLElement,
      querySelector: (sel: string) =>
        open.some(
          (o) => sel.includes(o) && !(o === "palette" && sel.includes(":not([data-palette])")),
        )
          ? ({} as Element)
          : null,
    });
    expect(modalDialogOpen(doc(['role="alertdialog"']) as never)).toBe(true);
    expect(modalDialogOpen(doc(['role="dialog"']) as never)).toBe(true);
    // A popover (role dialog, not modal) leaves body pointer events on.
    expect(modalDialogOpen(doc(['role="dialog"'], "") as never)).toBe(false);
    expect(modalDialogOpen(doc([]) as never)).toBe(false);
  });

  test("FR-SHELL-190 never in inputs: L / N / C / `/` / `?` typed into an input, textarea, contenteditable, select or a menu type (or do their own thing), nothing else", () => {
    const e = env();
    for (const t of [rollBar, textarea, editable, select, menuItem]) {
      for (const k of [key("l"), key("n"), key("c"), key("/"), key("?", { shiftKey: true })]) {
        const d = decide({ ...k, target: at(t) }, e);
        expect(d?.outcome).toBe("typing");
      }
    }
    // A checkbox or a button is no typing target: keys act there.
    expect(outcome(key("l", { target: at(checkbox) }), e)).toBe("window.log:ran");
    expect(outcome(key("l", { target: at(button) }), e)).toBe("window.log:ran");
  });

  test("FR-SHELL-190 Ctrl+K from a text field: the chord works from the roll bar, a textarea and contenteditable (P7)", () => {
    const e = env();
    for (const t of [rollBar, textarea, editable]) {
      expect(outcome(key("k", { ctrlKey: true, target: at(t) }), e)).toBe("shell.palette:ran");
    }
  });

  test("FR-SHELL-190 never while paused: a `blocksInput` overlay up → Ctrl+K, L, N, `?` do nothing, recorded `…:paused`", () => {
    const e = env(testCtx({ started: true }), { blocked: true });
    expect(outcome(key("k", { ctrlKey: true }), e)).toBe("shell.palette:paused");
    expect(outcome(key("l"), e)).toBe("window.log:paused");
    expect(outcome(key("n"), e)).toBe("cbt.next-turn:paused");
    expect(outcome(key("?", { shiftKey: true }), e)).toBe("shell.shortcuts:paused");
    // The players' pause entry is the blocker; the palette's own entry never blocks.
    const palette = OVERLAYS.find((o) => o.id === "palette");
    expect(palette?.blocksInput).toBeUndefined();
  });

  test("FR-SHELL-190 repeat and IME ignored: a held key or a composing key is no shortcut (nothing recorded)", () => {
    const e = env();
    expect(decide(key("l", { repeat: true }), e)).toBeNull();
    expect(decide(key("k", { ctrlKey: true, repeat: true }), e)).toBeNull();
    expect(decide(key("l", { isComposing: true }), e)).toBeNull();
  });

  test("FR-SHELL-190 punctuation by key: `/` and `?` match the character whatever Shift (German `/` = Shift+7); letters match case-insensitively with exact Ctrl / Alt / Meta; Ctrl+L does not fire L; Shift+N is its own key", () => {
    const e = env();
    expect(outcome(key("/", { shiftKey: true }), e)).toBe("shell.roll:ran");
    expect(outcome(key("/"), e)).toBe("shell.roll:ran");
    expect(outcome(key("?", { shiftKey: true }), e)).toBe("shell.shortcuts:ran");
    expect(outcome(key("L"), e)).toBe("window.log:ran");
    expect(outcome(key("l", { ctrlKey: true }), e)).toBeNull();
    expect(outcome(key("l", { altKey: true }), e)).toBeNull();
    expect(outcome(key("l", { metaKey: true }), e)).toBeNull();
    expect(outcome(key("L", { shiftKey: true }), e)).toBeNull();
    expect(outcome(key("n"), e)).toBe("cbt.next-turn:ran");
    expect(outcome(key("N", { shiftKey: true }), e)).toBe("cbt.prev-turn:ran");
    // Ctrl+/ is not `/`.
    expect(outcome(key("/", { ctrlKey: true }), e)).toBeNull();
  });

  test("FR-SHELL-186 N / Shift+N only while a fight is started; players have neither", () => {
    expect(outcome(key("n"), env(testCtx()))).toBe("cbt.next-turn:disabled");
    expect(outcome(key("n"), env(testCtx({ client: "player", started: true })))).toBeNull();
  });
});

describe("window keys (FR-SHELL-189)", () => {
  test("FR-SHELL-189 window keys toggle: a window key opens the window or brings it to front; pressed on the focused front window it minimises it", async () => {
    const ctx = testCtx();
    const e = env(ctx);
    const press = (k: string) => {
      const d = decide(key(k), e);
      expect(d?.outcome).toBe("ran");
      return d?.command.run(ctx);
    };
    await press("l");
    expect(stateOf(ctx, "dice.log")).toBe("open");
    await press("i");
    expect(stateOf(ctx, "cbt.initiative")).toBe("open");
    // L again: the log is behind Initiative → front, still open.
    await press("l");
    expect(stateOf(ctx, "dice.log")).toBe("open");
    // L once more: the log is the focused front window → minimised.
    await press("l");
    expect(stateOf(ctx, "dice.log")).toBe("minimised");
    await press("l");
    expect(stateOf(ctx, "dice.log")).toBe("open");
    for (const k of ["d", "b", "p", "s"]) await press(k);
    expect(
      ["dicex.tray", "cmp.compendium", "party.board", "stats.board"].map((k) => stateOf(ctx, k)),
    ).toEqual(["open", "open", "open", "open"]);
    // A window key whose kind isn't here (Rules before SP2) does nothing.
    expect(decide(key("r"), e)?.outcome).toBe("disabled");
  });
});

describe("shortcuts sheet (FR-SHELL-192, -193)", () => {
  test("FR-SHELL-192 sheet lists the registry: this client's keyed commands (window keys by their window's title), a disabled reason, then the fixed Map and rolls keys", () => {
    const dm = testCtx();
    const dmRows = sheetRows(
      forClient(COMMANDS, dm, () => false),
      dm,
      true,
    );
    expect(dmRows.map((r) => r.id)).toEqual([
      "shell.palette",
      "shell.shortcuts",
      "shell.roll",
      "cbt.next-turn",
      "cbt.prev-turn",
      "window.log",
      "window.initiative",
      "window.tray",
      "window.sheet",
      "window.compendium",
      "window.party",
      "window.stats",
    ]);
    expect(dmRows.find((r) => r.id === "cbt.next-turn")?.note).toBe("No fight started");
    // The registry's title: the test registry's party.board is "Party".
    expect(dmRows.find((r) => r.id === "window.party")?.title).toBe("Party");
    const p = testCtx({ client: "player" });
    const pRows = sheetRows(
      forClient(COMMANDS, p, () => false),
      p,
      true,
    );
    expect(pRows.some((r) => r.id === "cbt.next-turn" || r.id === "cbt.prev-turn")).toBe(false);
    const html = renderToStaticMarkup(<ShortcutsList rows={dmRows} mac={false} />);
    expect(html.match(/data-testid="ui-shortcuts-row"/g)?.length).toBe(dmRows.length);
    expect(html).toContain('data-record-id="shell.palette"');
    expect(html).toContain("Ctrl+K");
    expect(html).toContain("Shift+N");
    expect(html).toContain("Map and rolls");
    expect(html).toContain("Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y");
    expect(renderToStaticMarkup(<ShortcutsList rows={dmRows} mac />)).toContain("⌘K");
  });

  test("FR-SHELL-193 single-key off: only Ctrl / ⌘ chords work; the sheet marks the others Off; the setting is device-wide `pp.keys.v1` (default on, bad entry → on)", () => {
    const ctx = testCtx({ started: true });
    const e = env(ctx, { singleKey: false });
    expect(outcome(key("l"), e)).toBe("window.log:off");
    expect(outcome(key("n"), e)).toBe("cbt.next-turn:off");
    expect(outcome(key("?", { shiftKey: true }), e)).toBe("shell.shortcuts:off");
    expect(outcome(key("k", { ctrlKey: true }), e)).toBe("shell.palette:ran");
    const rows = sheetRows(
      forClient(COMMANDS, ctx, () => false),
      ctx,
      false,
    );
    expect(rows.find((r) => r.id === "window.log")?.note).toBe("Off");
    expect(rows.find((r) => r.id === "shell.palette")?.note).toBeUndefined();
    const data = new Map<string, string>();
    const backend = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    expect(readKeys(backend)).toEqual({ singleKey: true });
    setSingleKey(false, backend);
    expect(data.get(KEYS_KEY)).toBe('{"singleKey":false}');
    expect(keysSetting.getState().singleKey).toBe(false);
    expect(readKeys(backend)).toEqual({ singleKey: false });
    data.set(KEYS_KEY, '{"singleKey":"no"}');
    expect(readKeys(backend)).toEqual({ singleKey: true });
    setSingleKey(true, backend);
  });
});

describe("surface (FR-SHELL-181, -195, -196)", () => {
  test("FR-SHELL-181 overlay not window: an `overlays.ts` entry in both clients at layer 5 (below the pause card's 10), never blocking; no window kind, no layout entry: opening it leaves the layout as it was", () => {
    for (const client of ["dm", "player"] as const) {
      const mine = overlaysFor(client);
      const p = mine.find((o) => o.id === "palette");
      expect([p?.layer, p?.blocksInput]).toEqual([5, undefined]);
      const pause = mine.find((o) => o.id === "pause");
      if (pause) expect(pause.layer).toBeGreaterThan(p?.layer ?? 0);
    }
    const ctx = testCtx();
    expect(ctx.registry.defs.some((d) => d.kind.includes("palette"))).toBe(false);
    const before = JSON.stringify(ctx.controller.store.getState().windows);
    openPalette(">");
    expect(paletteUi.getState()).toMatchObject({ open: true, input: ">" });
    expect(JSON.stringify(ctx.controller.store.getState().windows)).toBe(before);
    closePalette();
  });

  test("FR-SHELL-195 top-bar button fits: one 40-px item in both clients before the identity chip; the launcher still fits at 1280×720 with labels (FR-SHELL-43)", () => {
    for (const client of ["dm", "player"] as const) {
      const items = topBarItemsFor(client, TOP_BAR_ITEMS);
      const p = items.find((t) => t.id === "palette");
      expect(p && topBarItemWidth(p, { w: 1280, h: 720 })).toBe(PALETTE_BUTTON_W);
      expect(PALETTE_BUTTON_W).toBe(40);
      // Last item: right next to the identity chip.
      expect(items.at(-1)?.id).toBe("palette");
      // The fixed items of the right cluster at 1280: DM Pause 128 + 40, players 40.
      const fixed = items.reduce((s, t) => s + topBarItemWidth(t, { w: 1280, h: 720 }), 0);
      expect(fixed).toBe(client === "dm" ? 168 : 40);
    }
    expect(paletteTip(false)).toBe("Search and commands (Ctrl+K)");
    expect(paletteTip(true)).toBe("Search and commands (⌘K)");
    // The launcher is the bottom bar: the top-bar button takes none of its room.
    const ctx = testCtx();
    const defs = ctx.registry.defs.filter((d) => d.launcher && ctx.available.has(d.kind));
    const m = launcherMetrics(
      new Map(defs.map((d) => [d.kind, d.launcher?.label ?? ""])),
      (l) => l.length * 7 + 1,
    );
    const fit = fitLauncher(
      defs.map((d) => ({ kind: d.kind, order: d.launcher?.order ?? 0, state: "closed" as const })),
      1280,
      m,
    );
    expect(fit.overflow).toEqual([]);
    expect((1280 - fittedBarWidth(fit, m)) / 2).toBeGreaterThanOrEqual(LAUNCHER_GUTTER);
  });

  test("FR-SHELL-196 states: Searching…; Couldn't search the compendium + Retry; offline one line; No matches; local rows render whatever the server state", () => {
    const ctx = testCtx();
    const sections = rankLocal(
      localEntries(
        forClient(COMMANDS, ctx, () => false),
        [],
        ctx,
      ),
      "log",
    );
    const render = (server: Parameters<typeof PaletteList>[0]["server"], s = sections) =>
      renderToStaticMarkup(
        <PaletteList sections={s} server={server} active={0} listId="l" mac={false} />,
      );
    expect(render("searching")).toContain("Searching…");
    expect(render("error")).toContain("Couldn&#x27;t search the compendium");
    expect(render("error")).toContain('data-testid="ui-palette-retry"');
    expect(render("offline")).toContain("Offline: compendium search unavailable");
    for (const s of ["searching", "error", "offline", "ready", "local"] as const) {
      expect(render(s)).toContain('data-testid="ui-palette-item"');
    }
    expect(render("ready", [])).toContain('data-testid="ui-palette-empty"');
    expect(render("searching", [])).not.toContain("ui-palette-empty");
    // FR-SHELL-197: group and item test ids, values, record ids; the highlighted row selected.
    const html = render("local");
    expect(html).toContain('data-testid="ui-palette-group" data-value="Windows"');
    expect(html).toContain('data-record-id="dice.log" data-value="Windows"');
    expect(html).toContain('aria-selected="true"');
    // Disabled rows carry their reason.
    const disabled = rankLocal(
      localEntries(
        forClient(COMMANDS, ctx, () => false),
        [],
        ctx,
      ),
      "next turn",
    );
    expect(render("local", disabled)).toContain("No fight started");
  });
});
