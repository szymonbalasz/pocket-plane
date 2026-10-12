import { describe, expect, test } from "bun:test";
import { isBaseKeyTarget, SHELL_ZONE_ATTR } from "./keys";

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
