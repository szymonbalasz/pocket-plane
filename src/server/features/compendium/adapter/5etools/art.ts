// FR-CMPX-23: a monster's token file per 5etools' own rule. The path rule is the one the art
// listener checks again before reading (X3).
import { asStr, isRaw, nameOf, type Raw, sourceOf } from "./raw";

export const ART_PATH_MAX = 200;

/** Relative, under `img/`, ≤ 200, no `..`, no backslash, no drive, no leading `/`. */
export function isValidArtPath(p: string): boolean {
  return (
    p.length <= ART_PATH_MAX &&
    p.startsWith("img/") &&
    !p.includes("..") &&
    !p.includes("\\") &&
    !p.includes(":") &&
    !p.includes("\0")
  );
}

/** 5etools' token file name: ASCII letters, no double quotes. */
export const tokenFileName = (name: string) =>
  name
    .replace(/Æ/g, "AE")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/"/g, "");

/** `token {name, source}` first, else the monster's own (both after `_copy`). */
export function tokenPath(m: Raw): string {
  const t = isRaw(m.token) ? m.token : {};
  const name = asStr(t.name) ?? nameOf(m);
  const source = asStr(t.source) ?? sourceOf(m);
  return `img/bestiary/tokens/${source}/${tokenFileName(name)}.webp`;
}
