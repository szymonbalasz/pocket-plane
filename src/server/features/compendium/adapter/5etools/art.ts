// FR-CMPX-23: a monster's token file per 5etools' own rule (`isValidArtPath` in
// `@shared/compendium/schemas` is checked by the caller).
import { asStr, isRaw, nameOf, type Raw, sourceOf } from "./raw";

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
