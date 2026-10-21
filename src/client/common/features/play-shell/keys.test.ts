import { describe, expect, test } from "bun:test";
import {
  isBaseKeyTarget,
  isKeyboardFocus,
  SHELL_ZONE_ATTR,
  spaceAction,
  trackFocusModality,
} from "./keys";

// Minimal element stub: tag, attributes, parent, and `closest` over simple selectors
// (`tag`, `[attr]`, `[attr="v"]`), enough for the selector list in keys.ts.
interface El {
  tag: string;
  attrs: Record<string, string>;
  parent: El | null;
  isContentEditable?: boolean;
  closest(sel: string): El | null;
}

function matches(el: El, simple: string): boolean {
  const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(simple);
  if (attr) {
    const [, name, value] = attr;
    if (!name || !(name in el.attrs)) return false;
    return value === undefined || el.attrs[name] === value;
  }
  return el.tag === simple;
}

function el(tag: string, attrs: Record<string, string> = {}, parent: El | null = null): El {
  const e: El = {
    tag,
    attrs,
    parent,
    closest(sel) {
      const parts = sel.split(",").map((s) => s.trim());
      for (let cur: El | null = e; cur; cur = cur.parent) {
        if (parts.some((p) => matches(cur as El, p))) return cur;
      }
      return null;
    },
  };
  return e;
}

/** Stub base-layer key handler, wired like the shell's: only base targets reach it. */
function stubBase() {
  const got: string[] = [];
  return {
    got,
    keydown(target: El | null, key: string) {
      if (isBaseKeyTarget(target)) got.push(key);
    },
  };
}

describe("FR-SHELL-13 key routing", () => {
  const body = el("body");
  const base = el("div", { "data-testid": "ui-base" }, body);
  const win = el("section", { [SHELL_ZONE_ATTR]: "window" }, body);
  const topbar = el("header", { [SHELL_ZONE_ATTR]: "topbar" }, body);
  const launcher = el("nav", { [SHELL_ZONE_ATTR]: "launcher" }, body);
  const dialog = el("div", { role: "dialog" }, body);

  test("FR-SHELL-13 Ctrl+D in a window input, top bar, launcher or dialog never reaches the base", () => {
    const b = stubBase();
    b.keydown(el("input", {}, win), "Ctrl+D");
    b.keydown(el("button", {}, win), "Ctrl+D");
    b.keydown(el("button", {}, topbar), "Ctrl+D");
    b.keydown(el("button", {}, launcher), "Ctrl+D");
    b.keydown(el("button", {}, dialog), "Ctrl+D");
    b.keydown(el("div", { role: "menu" }, body), "Ctrl+D");
    expect(b.got).toEqual([]);
  });

  test("FR-SHELL-13 editable elements anywhere never reach the base", () => {
    const b = stubBase();
    b.keydown(el("input", {}, body), "Delete");
    b.keydown(el("textarea", {}, body), "Delete");
    b.keydown(el("select", {}, body), "Delete");
    b.keydown(el("div", { contenteditable: "true" }, body), "Delete");
    b.keydown({ ...el("div", {}, body), isContentEditable: true }, "Delete");
    expect(b.got).toEqual([]);
  });

  test("FR-SHELL-13 keys on the base, body or no target reach the base", () => {
    const b = stubBase();
    b.keydown(base, "Ctrl+D");
    b.keydown(body, "Delete");
    b.keydown(null, "Escape");
    expect(b.got).toEqual(["Ctrl+D", "Delete", "Escape"]);
  });
});

describe("FR-SHELL-83 Space presses a keyboard-focused control (keeps #199 / FR-FOG-17)", () => {
  // A compound-selector stub: `tag`, `[attr]`, `[attr="v"]`, `:not([attr="v"])` in any order.
  const compound = (e: El, sel: string): boolean => {
    const tag = /^[a-z]+/.exec(sel)?.[0];
    if (tag && e.tag !== tag) return false;
    for (const m of sel.matchAll(/(:not\()?\[([\w-]+)(?:="([^"]*)")?\]\)?/g)) {
      const [, not, name = "", value] = m;
      const has = name in e.attrs && (value === undefined || e.attrs[name] === value);
      if (not ? has : !has) return false;
    }
    return true;
  };
  const node = (tag: string, attrs: Record<string, string> = {}, parent: El | null = null) => {
    const e = el(tag, attrs, parent);
    e.closest = (sel) => {
      const parts = sel.split(",").map((s) => s.trim());
      for (let cur: El | null = e; cur; cur = cur.parent) {
        if (parts.some((p) => compound(cur as El, p))) return cur;
      }
      return null;
    };
    return e;
  };
  const page = node("div");
  const launcher = node("nav", { [SHELL_ZONE_ATTR]: "launcher" }, page);
  const win = node("section", { [SHELL_ZONE_ATTR]: "window" }, page);
  const controls = {
    "launcher button": node("button", {}, launcher),
    switch: node("button", { role: "switch" }, win),
    checkbox: node("button", { role: "checkbox" }, win),
    "menu item": node("div", { role: "menuitem" }, node("div", { role: "menu" }, page)),
    'role="button" div': node("div", { role: "button" }, win),
    "fog bar toggle": node("button", { "aria-pressed": "false" }, page),
  };

  test("FR-SHELL-83 Space presses buttons: (i) Tab onto a control (keyboard focus), pointer over the map → the browser's (activates, no pan)", () => {
    for (const [name, c] of Object.entries(controls)) {
      expect({ name, got: spaceAction(c, { keyboard: true, overMap: true }) }).toEqual({
        name,
        got: "browser",
      });
    }
  });

  test("FR-SHELL-83 Space presses buttons: (ii) a clicked control (pointer focus), pointer over the map → pans, never presses (#199); pointer off the map → presses", () => {
    const toggle = controls["fog bar toggle"];
    expect(spaceAction(toggle, { keyboard: false, overMap: true })).toBe("pan");
    expect(spaceAction(controls["launcher button"], { keyboard: false, overMap: true })).toBe(
      "pan",
    );
    expect(spaceAction(toggle, { keyboard: false, overMap: false })).toBe("browser");
    // The map itself (the canvas container takes focus on pointer-down) and the page: pan.
    const canvas = node("div", { role: "application", tabindex: "-1" }, page);
    expect(spaceAction(canvas, { keyboard: false, overMap: true })).toBe("pan");
    expect(spaceAction(canvas, { keyboard: false, overMap: false })).toBe("pan");
    expect(spaceAction(null, { keyboard: false, overMap: true })).toBe("pan");
  });

  test("FR-SHELL-83 typing and dialogs never reach the map; a menu item's Space stays the menu's", () => {
    const dialog = node("div", { role: "dialog" }, page);
    const inDialog = node("div", {}, dialog);
    const field = node("input", { type: "text" }, win);
    const box = node("input", { type: "checkbox" }, page);
    for (const t of [inDialog, field, controls["menu item"]]) {
      expect(spaceAction(t, { keyboard: false, overMap: true })).toBe("browser");
    }
    // A native checkbox is a control, not a field: pointer focus over the map pans.
    expect(spaceAction(box, { keyboard: false, overMap: true })).toBe("pan");
    expect(spaceAction(box, { keyboard: true, overMap: true })).toBe("browser");
  });

  test("FR-SHELL-83 keyboard focus is read when focus lands (:focus-visible then), not at the keydown", () => {
    type FocusFn = (e: { target: EventTarget | null }) => void;
    let onFocus: FocusFn = () => {};
    let onPress: FocusFn = () => {};
    const doc = {
      addEventListener: (type: "focusin" | "pointerdown", fn: FocusFn) => {
        if (type === "focusin") onFocus = fn;
        else onPress = fn;
      },
    };
    trackFocusModality(doc);
    let visible = false;
    const button = { matches: (s: string) => s === ":focus-visible" && visible };
    const target = button as unknown as EventTarget;
    visible = true; // Tab
    onFocus({ target });
    expect(isKeyboardFocus(target)).toBe(true);
    visible = false; // a click
    onFocus({ target });
    visible = true; // a key pressed later makes it :focus-visible; the click focus stays pointer
    expect(isKeyboardFocus(target)).toBe(false);
    expect(isKeyboardFocus(null)).toBe(false);
    // Tab onto it, then a click on it (already focused: no focusin) → pointer focus again.
    visible = true;
    onFocus({ target });
    expect(isKeyboardFocus(target)).toBe(true);
    const icon = { parentElement: button } as unknown as EventTarget;
    onPress({ target: icon });
    expect(isKeyboardFocus(target)).toBe(false);
  });
});
