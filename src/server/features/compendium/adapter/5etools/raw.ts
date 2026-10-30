// Untrusted 5etools JSON (compendium-expansion §11): narrow accessors, never a throw on a wrong
// type. Only `{name, source}` is checked at read; each mapped record is validated by zod on output.
export type Raw = Record<string, unknown>;

export const isRaw = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const rawList = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isRaw) : []);
export const asStr = (v: unknown) => (typeof v === "string" ? v : undefined);
export const asNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** `Goblin|MM` (either case) as a lookup key; 5etools matches names and sources case-insensitively. */
export const refKey = (name: string, source: string) =>
  `${name.trim().toLowerCase()}|${source.trim().toLowerCase()}`;

export const nameOf = (r: Raw) => asStr(r.name) ?? "";
export const sourceOf = (r: Raw) => asStr(r.source) ?? "";
