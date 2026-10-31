// Shortcut keys (FR-SHELL-189–191, ADR-0067 §2): the §7 table, the reserved keys no shortcut may
// take, and how a `keydown` matches a key. Letters match `e.key` case-insensitively with Ctrl /
// Alt / Meta exact (L ≠ Ctrl+L; Shift+N is its own key); printable punctuation matches `e.key`
// with Shift ignored, so layouts that need Shift for it (German `/` = Shift+7) work (ruling 13).
// `Mod` = Ctrl, ⌘ on macOS. Pure.

/** A key as the registry writes it: `"L"`, `"Shift+N"`, `"?"`, `"/"`, `"Mod+K"`. */
export type KeySpec = string;

interface Parsed {
  key: string;
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  shift: boolean;
}

const isLetter = (k: string) => /^[a-z]$/i.test(k);

export function parseKey(spec: KeySpec): Parsed {
  const parts = spec.split("+");
  // "Shift++" would be a plus; the table has none.
  const key = parts.pop() ?? "";
  const has = (m: string) => parts.includes(m);
  return {
    key: isLetter(key) ? key.toLowerCase() : key,
    mod: has("Mod"),
    ctrl: has("Ctrl"),
    alt: has("Alt"),
    meta: has("Meta"),
    shift: has("Shift"),
  };
}

/** The modifiers a key event carries. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** `spec` is pressed by `e` (`mac`: `Mod` = ⌘, else Ctrl). */
export function matchesKey(spec: KeySpec, e: KeyLike, mac: boolean): boolean {
  const p = parseKey(spec);
  const ctrl = p.ctrl || (p.mod && !mac);
  const meta = p.meta || (p.mod && mac);
  if (e.ctrlKey !== ctrl || e.metaKey !== meta || e.altKey !== p.alt) return false;
  if (isLetter(p.key)) return e.key.toLowerCase() === p.key && e.shiftKey === p.shift;
  // Punctuation: by the character produced, Shift ignored (ruling 13).
  return e.key === p.key;
}

/** A single-key shortcut (no Ctrl / Alt / ⌘): switched off by FR-SHELL-193; Shift doesn't count. */
export function isSingleKey(spec: KeySpec): boolean {
  const p = parseKey(spec);
  return !(p.mod || p.ctrl || p.alt || p.meta);
}

/** The chip text: `Ctrl+K` / `⌘K`, `Shift+N`, `?`. */
export function keyLabel(spec: KeySpec, mac: boolean): string {
  const p = parseKey(spec);
  const key = isLetter(p.key) ? p.key.toUpperCase() : p.key;
  const mods = [
    ...(p.ctrl || (p.mod && !mac) ? ["Ctrl"] : []),
    ...(p.alt ? ["Alt"] : []),
    ...(p.shift ? ["Shift"] : []),
  ];
  const cmd = p.meta || (p.mod && mac) ? "⌘" : "";
  return `${cmd}${[...mods, key].join("+")}`;
}

/** FR-SHELL-189: play-shell §7's shortcut table, per client (a key is assigned only there). */
export const SHORTCUT_TABLE: Readonly<Record<KeySpec, readonly ("dm" | "player")[]>> = {
  "Mod+K": ["dm", "player"],
  "?": ["dm", "player"],
  "/": ["dm", "player"],
  L: ["dm", "player"],
  I: ["dm", "player"],
  D: ["dm", "player"],
  C: ["dm", "player"],
  B: ["dm", "player"],
  R: ["dm", "player"],
  P: ["dm", "player"],
  S: ["dm", "player"],
  N: ["dm"],
  "Shift+N": ["dm"],
};

/**
 * FR-SHELL-191 (rulings 12, 15): keys that already mean something; no shortcut uses them. Space
 * (press vs pan), Escape, Ctrl+D (duplicate), Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (undo / redo), Enter
 * and its roll modifiers, Tab, arrows, Backspace / Delete (fog tool).
 */
export const RESERVED_KEYS: readonly KeySpec[] = [
  " ",
  "Escape",
  "Mod+D",
  "Ctrl+D",
  "Meta+D",
  "Mod+Z",
  "Ctrl+Z",
  "Meta+Z",
  "Mod+Shift+Z",
  "Ctrl+Shift+Z",
  "Mod+Y",
  "Ctrl+Y",
  "Enter",
  "Shift+Enter",
  "Ctrl+Enter",
  "Tab",
  "Shift+Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Backspace",
  "Delete",
];

/** The fixed "Map and rolls" rows of the shortcuts sheet (FR-SHELL-191, -192). */
export const FIXED_KEYS: readonly { keys: string; title: string; dmOnly?: true }[] = [
  { keys: "Space", title: "Hold and drag to pan the map; press a focused button" },
  { keys: "Escape", title: "Clear a search, close a dialog, end a tool, dismiss a request" },
  // The DM's map tools (FR-MAP-17, fog, structure, props): no player has them.
  { keys: "Ctrl+D", title: "Duplicate the selected tokens", dmOnly: true },
  {
    keys: "Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y",
    title: "Undo / redo in fog, structure and props",
    dmOnly: true,
  },
  { keys: "Backspace / Delete", title: "Delete in the fog tool", dmOnly: true },
  { keys: "Enter", title: "Roll from a roll field (Shift advantage, Ctrl disadvantage)" },
  { keys: "↑ / ↓", title: "Move in lists and chip rows" },
];

/** The fixed rows this client's sheet lists. */
export const fixedKeysFor = (client: "dm" | "player") =>
  FIXED_KEYS.filter((f) => client === "dm" || !f.dmOnly);

/** Two specs press the same key (same key, same modifiers, either platform). */
export function sameKey(a: KeySpec, b: KeySpec): boolean {
  for (const mac of [false, true]) {
    const p = parseKey(a);
    const probe: KeyLike = {
      key: p.key,
      ctrlKey: p.ctrl || (p.mod && !mac),
      altKey: p.alt,
      metaKey: p.meta || (p.mod && mac),
      shiftKey: p.shift,
    };
    if (matchesKey(b, probe, mac)) return true;
  }
  return false;
}
