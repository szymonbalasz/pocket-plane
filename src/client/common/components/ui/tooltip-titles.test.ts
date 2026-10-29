import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// FR-SHELL-30 / FR-CHAR-25: hover hints are the shared Tooltip. A native `title` can't be delayed
// or suppressed, so it may stay only on non-interactive truncated text.

const CLIENT = join(import.meta.dir, "../../..");
/** Tags that render a button or link. */
const INTERACTIVE = new Set(["button", "a", "Button", "RollButton", "ToggleGroupItem"]);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

/** JSX opening tags: name + the attribute text outside `{…}` (string literals kept). */
function openingTags(src: string): { name: string; attrs: string; line: number }[] {
  const tags: { name: string; attrs: string; line: number }[] = [];
  const re = /<([A-Za-z][\w.]*)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (/[\w)\]]/.test(src[m.index - 1] ?? "")) continue; // generics, not JSX
    let depth = 0;
    let quote = "";
    let attrs = "";
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const ch = src[i] as string;
      if (quote) {
        if (depth === 0) attrs += ch;
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
      if (depth === 0) attrs += ch;
    }
    tags.push({ name: m[1] as string, attrs, line: src.slice(0, m.index).split("\n").length });
  }
  return tags;
}

test("FR-SHELL-30 no native title on interactive elements in src/client", () => {
  const bad: string[] = [];
  for (const file of tsxFiles(CLIENT)) {
    for (const t of openingTags(readFileSync(file, "utf8"))) {
      if (!/(^|\s)title=/.test(t.attrs)) continue;
      const intrinsic = /^[a-z]/.test(t.name);
      const interactive = INTERACTIVE.has(t.name) || /role="button"/.test(t.attrs);
      // Components' `title` props (dialog headings) aren't native titles.
      if (!intrinsic && !interactive) continue;
      if (interactive || !/\btruncate\b/.test(t.attrs)) {
        bad.push(`${relative(CLIENT, file)}:${t.line} <${t.name}>`);
      }
    }
  }
  expect(bad).toEqual([]);
}, 30_000); // scans every .tsx under src/client: over the 5 s default while other suites run

test("FR-CHAR-25 roll buttons carry no title; the hint is a Tooltip", () => {
  const src = readFileSync(
    join(CLIENT, "common/features/character-sheet/CharacterSheet.tsx"),
    "utf8",
  );
  const rollButtons = openingTags(src).filter((t) => t.name === "RollButton");
  expect(rollButtons.length).toBeGreaterThanOrEqual(2);
  for (const t of rollButtons) expect(t.attrs).not.toMatch(/(^|\s)title=/);
  // FR-DICEX-51: `RollButton` draws the Tooltip; the sheet passes its text as `hint` (FR-CHARX-113:
  // `rollHint`, the breakdown then the mode keys).
  expect(src).toMatch(/hint=\{rollHint\(/);
  expect(src).not.toMatch(/title=\{proficient/);
});

// ---- FR-SHELL-84: icon-only buttons carry a Tooltip ----

interface JsxEl {
  name: string;
  /** The opening tag's source. */
  open: string;
  line: number;
  parent: JsxEl | null;
  /** Shows letters or digits: JSX text, or a `{…}` child that isn't only JSX. */
  textful: boolean;
}

const KEYWORDS_BEFORE_EXPR = new Set(["return", "yield", "default", "case", "await", "else"]);

/** Every JSX element of a .tsx source with its parent; throws where it loses track. */
function jsxTree(src: string, file: string): JsxEl[] {
  const els: JsxEl[] = [];
  const fail = (i: number, why: string): never => {
    throw new Error(
      `${file}:${src.slice(0, i).split("\n").length} jsxTree: ${why} (after ${els.slice(-2).map((e) => `<${e.name}>:${e.line}`)})`,
    );
  };
  const skipString = (i: number): number => {
    const q = src[i];
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === "\\") j++;
      else if (src[j] === q) return j + 1;
    }
    return fail(i, "unterminated string");
  };
  const skipRegex = (i: number): number => {
    let cls = false;
    for (let j = i + 1; j < src.length; j++) {
      const c = src[j];
      if (c === "\\") j++;
      else if (c === "[") cls = true;
      else if (c === "]") cls = false;
      else if (c === "/" && !cls) {
        j++;
        while (/[a-z]/.test(src[j] ?? "")) j++;
        return j;
      } else if (c === "\n") return fail(i, "unterminated regex");
    }
    return fail(i, "unterminated regex");
  };
  /** JS from `i` up to (not past) the `}` closing the current brace, or to the end. */
  const code = (start: number, parent: JsxEl | null, inBrace: boolean): number => {
    let depth = 0;
    let prev = ""; // last significant character
    let word = ""; // last identifier, for `return <div>` / `return /re/`
    for (let i = start; i < src.length; ) {
      const c = src[i] as string;
      const next = src[i + 1] ?? "";
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === "/" && next === "/") {
        i = src.indexOf("\n", i);
        if (i < 0) i = src.length;
        continue;
      }
      if (c === "/" && next === "*") {
        i = src.indexOf("*/", i + 2) + 2;
        continue;
      }
      const exprPos =
        prev === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || KEYWORDS_BEFORE_EXPR.has(word);
      if (c === "'" || c === '"') i = skipString(i);
      else if (c === "`") {
        let j = i + 1;
        for (; j < src.length && src[j] !== "`"; j++) {
          if (src[j] === "\\") j++;
          else if (src[j] === "$" && src[j + 1] === "{") j = code(j + 2, parent, true);
        }
        i = j + 1;
      } else if (c === "/" && exprPos) i = skipRegex(i);
      else if (c === "<" && exprPos && /[A-Za-z>]/.test(next)) i = element(i, parent);
      else if (c === "{" || c === "(" || c === "[") {
        if (c === "{") depth++;
        i++;
      } else if (c === "}") {
        if (depth === 0) {
          if (inBrace) return i;
          fail(i, "unbalanced }");
        }
        depth--;
        i++;
      } else i++;
      if (/[\w$]/.test(c)) {
        let j = i;
        while (/[\w$]/.test(src[j - 1] ?? "") && j > start) j--;
        let k = i;
        while (/[\w$]/.test(src[k] ?? "")) k++;
        word = src.slice(j, k);
        i = k;
        prev = "a";
      } else {
        word = "";
        prev = c;
      }
    }
    if (inBrace) fail(start, "unterminated {");
    return src.length;
  };
  /** A `{…}` at `i`; returns the index after `}` and whether it showed text. */
  const braced = (i: number, parent: JsxEl | null): { end: number; textful: boolean } => {
    const before = els.length;
    const end = code(i + 1, parent, true);
    const body = src
      .slice(i + 1, end)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    const inner = els.slice(before).filter((e) => e.parent === parent);
    const textful = body !== "" && (inner.length === 0 || inner.some((e) => e.textful));
    return { end: end + 1, textful };
  };
  /** Children up to the closing tag; returns the index after it. */
  const children = (start: number, el: JsxEl | null): number => {
    let textful = false;
    for (let i = start; i < src.length; ) {
      const c = src[i] as string;
      if (c === "<" && src[i + 1] === "/") {
        if (el && textful) el.textful = true;
        return src.indexOf(">", i) + 1;
      }
      if (c === "<") {
        const before = els.length;
        i = element(i, el);
        if (els.slice(before).some((e) => e.parent === el && e.textful)) textful = true;
      } else if (c === "{") {
        const b = braced(i, el);
        if (b.textful) textful = true;
        i = b.end;
      } else {
        if (/[A-Za-z0-9]/.test(c)) textful = true;
        i++;
      }
    }
    return fail(start, "unclosed element");
  };
  /** An element (or fragment) at `i`; returns the index after it. */
  function element(i: number, parent: JsxEl | null): number {
    if (src[i + 1] === ">") {
      // A fragment's children belong to the enclosing element.
      const before = els.length;
      const end = children(i + 2, parent);
      if (parent && els.slice(before).some((e) => e.parent === parent && e.textful)) {
        parent.textful = true;
      }
      return end;
    }
    const name = /^<([\w.:-]+)/.exec(src.slice(i, i + 100))?.[1] ?? fail(i, "bad tag");
    let j = i + 1 + name.length;
    if (/^\s*(,|extends\b)/.test(src.slice(j, j + 20))) return j; // `<T,>` / `<T extends …>`: a generic
    if (src[j] === "<") {
      // Type arguments: `<SheetField<string>`.
      for (let depth = 0; j < src.length; j++) {
        if (src[j] === "<") depth++;
        else if (src[j] === ">" && --depth === 0) break;
      }
      j++;
    }
    const el: JsxEl = {
      name,
      open: "",
      line: src.slice(0, i).split("\n").length,
      parent,
      textful: false,
    };
    els.push(el);
    for (; j < src.length; ) {
      const c = src[j] as string;
      if (c === "{") j = code(j + 1, parent, true) + 1;
      else if (c === '"' || c === "'") j = skipString(j);
      else if (c === "/" && src[j + 1] === "/") j = src.indexOf("\n", j);
      else if (c === "/" && src[j + 1] === "*") j = src.indexOf("*/", j) + 2;
      else if (c === "/" && src[j + 1] === ">") {
        el.open = src.slice(i, j + 2);
        return j + 2;
      } else if (c === ">") {
        el.open = src.slice(i, j + 1);
        return children(j + 1, el);
      } else j++;
    }
    return fail(i, "unclosed tag");
  }
  code(0, null, false);
  return els;
}

const BUTTONS = new Set(["button", "Button"]);
const isTip = (name: string) => name === "Tooltip" || /Tip$/.test(name);

/**
 * `file#data-testid` of icon-only buttons whose hint lives elsewhere: the element is kept in a
 * variable or returned bare and wrapped where it's used, or the hint is on purpose not a Tooltip.
 */
const HINT_ELSEWHERE = new Set([
  // BL-36: the swatch row has a reason line under it instead of Tooltips.
  "common/features/campaign-management/ColorPicker.tsx#camp-color-swatch",
  // Kept in a variable; the Tooltip (on a wrapper span while disabled) is drawn below it.
  "common/features/fog-of-war/FogBar.tsx#fog-undo",
  "common/features/fog-of-war/BrushControls.tsx#fog-redo",
]);

test("FR-SHELL-84 icon-only buttons in src/client carry a Tooltip", () => {
  const bad: string[] = [];
  let buttons = 0;
  for (const file of tsxFiles(CLIENT)) {
    if (/\.test\.tsx$/.test(file)) continue;
    const rel = relative(CLIENT, file).replaceAll("\\", "/");
    for (const el of jsxTree(readFileSync(file, "utf8"), rel)) {
      if (!BUTTONS.has(el.name)) continue;
      buttons++;
      if (el.textful || /\basChild\b/.test(el.open)) continue;
      let up = el.parent;
      while (up && !isTip(up.name)) up = up.parent;
      if (up) continue;
      const id = /data-testid=(?:"([^"]+)"|\{([^}]+)\})/.exec(el.open);
      if (HINT_ELSEWHERE.has(`${rel}#${id?.[1] ?? id?.[2] ?? ""}`)) continue;
      bad.push(`${rel}:${el.line} <${el.name}> ${id?.[1] ?? id?.[2] ?? ""}`);
    }
  }
  // The scanner found the buttons (a parser slip would find few and pass).
  expect(buttons).toBeGreaterThan(400);
  expect(bad).toEqual([]);
}, 30_000);
