// One book's adapter run: warnings and the output records, in the Open5e adapter's style
// (AdapterResult), with FR-CMP-01 caps as clips: a too-long text is clipped with a warning, the
// record stays. Only a record the schema still refuses (or a duplicate key) is skipped.
import {
  type CompendiumKind,
  ENTRY_MAX_BYTES,
  EntryDraft,
  SourceKey,
} from "@shared/compendium/schemas";
import type { AdapterRecord, AdapterResult } from "../open5e";

export type FiveEtoolsResult = AdapterResult;

const jsonBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** The longest string in `v`, as a path for a warning and a setter. */
function longestString(
  v: unknown,
  path: string,
  set: (s: string) => void,
): { path: string; length: number; value: string; set: (s: string) => void } | null {
  if (typeof v === "string") return { path, length: v.length, value: v, set };
  const parts: [string, unknown, (s: string) => void][] = Array.isArray(v)
    ? v.map((x, i) => [
        `${path}[${i}]`,
        x,
        (s: string) => {
          v[i] = s;
        },
      ])
    : typeof v === "object" && v !== null
      ? Object.entries(v).map(([k, x]) => [
          `${path}.${k}`,
          x,
          (s: string) => {
            (v as Record<string, unknown>)[k] = s;
          },
        ])
      : [];
  let best: ReturnType<typeof longestString> = null;
  for (const [p, x, setter] of parts) {
    const l = longestString(x, p, setter);
    if (l && (!best || l.length > best.length)) best = l;
  }
  return best;
}

export const clipTo = (s: string, max: number) =>
  s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;

export class Run {
  records: AdapterRecord[] = [];
  warnings: AdapterResult["warnings"] = [];
  skipped = 0;
  private seen = new Set<string>();

  warn(sourceKey: string, field: string, message: string) {
    this.warnings.push({ sourceKey, field, message });
  }

  skip(sourceKey: string, field: string, message: string) {
    this.warn(sourceKey, field, message);
    this.skipped++;
  }

  /** Over `max` characters → clipped + warning (FR-CMP-01). */
  clip(key: string, field: string, s: string, max: number) {
    if (s.length <= max) return s;
    this.warn(key, field, `Longer than ${max} characters; clipped`);
    return clipTo(s, max);
  }

  /** FR-CMP-01's 32 KB: the longest text is clipped until the entry fits. */
  private fitEntry(rec: AdapterRecord) {
    const d = rec.data;
    for (let i = 0; i < 200; i++) {
      const over = jsonBytes({ facets: d.facets, body: d.body }) - ENTRY_MAX_BYTES;
      if (over <= 0) return;
      const l = longestString(d.body, "body", () => {});
      if (!l || l.length === 0) return;
      // A non-ASCII character is up to 3 bytes (one more for its JSON escape): over-clip a little.
      l.set(clipTo(l.value, Math.max(0, l.length - over - 16)));
      this.warn(rec.sourceKey, l.path, `Entry over ${ENTRY_MAX_BYTES} bytes; clipped`);
    }
  }

  /** FR-CMPX-11: one key per book; zod on everything that goes out. */
  push(rec: AdapterRecord) {
    if (!SourceKey.safeParse(rec.sourceKey).success) {
      return this.skip(rec.sourceKey, "sourceKey", "Name gives no usable key");
    }
    if (this.seen.has(rec.sourceKey)) {
      return this.skip(rec.sourceKey, "sourceKey", "Duplicate; later record dropped");
    }
    this.fitEntry(rec);
    const r = EntryDraft.safeParse(rec.data);
    if (!r.success) {
      for (const i of r.error.issues) this.warn(rec.sourceKey, i.path.join("."), i.message);
      this.skipped++;
      return;
    }
    this.seen.add(rec.sourceKey);
    this.records.push(rec);
  }

  result(): FiveEtoolsResult {
    const counts: Record<CompendiumKind, number> = {
      monster: 0,
      spell: 0,
      item: 0,
      condition: 0,
      feature: 0,
      rule: 0,
    };
    for (const r of this.records) counts[r.kind]++;
    return { records: this.records, warnings: this.warnings, skipped: this.skipped, counts };
  }
}
