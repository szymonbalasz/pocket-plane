// FR-CMP-06 bundled licence: the repo holds SRD 5.1 text only, with the exact CC BY 4.0 statement.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { srdMini } from "@fixtures/srd/open5e";
import { SRD_ATTRIBUTION } from "@fixtures/srd/source";
import { OPEN5E_ENDPOINTS } from "../../adapter/open5e";
import { loadSrd51, SRD_51_DIR } from ".";
import { ATTRIBUTION_FILE, OPEN5E_V1_URL, SRD_51_ATTRIBUTION } from "./source";

type Rec = { slug: string; document__slug?: unknown; archetypes?: Rec[] };

/** Every record and nested archetype that isn't `wotc-srd`, as `<endpoint>/<slug>[/<archetype>]`. */
function nonSrd(endpoint: string, records: readonly unknown[]): string[] {
  return (records as Rec[]).flatMap((r) => [
    ...(r.document__slug === "wotc-srd" ? [] : [`${endpoint}/${r.slug}`]),
    ...(r.archetypes ?? [])
      .filter((a) => a.document__slug !== "wotc-srd")
      .map((a) => `${endpoint}/${r.slug}/${a.slug}`),
  ]);
}

describe("FR-CMP-06 bundled licence", () => {
  test("every bundled record, nested archetypes included, is wotc-srd", () => {
    const { responses } = loadSrd51();
    let archetypes = 0;
    for (const e of OPEN5E_ENDPOINTS) {
      const records = responses[e] ?? [];
      expect(records.length).toBeGreaterThan(0);
      expect(nonSrd(e, records)).toEqual([]);
      for (const r of records as Rec[]) archetypes += r.archetypes?.length ?? 0;
    }
    expect(archetypes).toBe(12);
  });

  test("every fixture record (fixtures/srd/open5e) is wotc-srd and matches the bundled one", () => {
    const { responses } = loadSrd51();
    for (const e of OPEN5E_ENDPOINTS) {
      const mini = srdMini[e] ?? [];
      expect(mini.length).toBeGreaterThan(0);
      expect(nonSrd(e, mini)).toEqual([]);
      for (const r of mini as Rec[]) {
        expect((responses[e] as Rec[]).find((b) => b.slug === r.slug)).toEqual(r);
      }
    }
  });

  test("attribution file: exact SRD 5.1 CC BY 4.0 statement + Open5e v1 provenance", () => {
    const text = readFileSync(path.join(SRD_51_DIR, ATTRIBUTION_FILE), "utf8");
    expect(SRD_51_ATTRIBUTION).toBe(SRD_ATTRIBUTION);
    expect(text).toContain(SRD_ATTRIBUTION);
    expect(text).toContain(OPEN5E_V1_URL);
  });
});
