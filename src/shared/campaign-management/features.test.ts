// FR-CAMP-41 feature registry (ADR-0058): unique kebab-case keys, a known spec prefix as owner,
// short texts; FR-CAMP-39's key schema; FR-CAMP-38's wire field.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FEATURES, FeatureKey, featureDef, GEMS_FEATURE, hasFeature } from "./features";
import { CampaignRecord, SetFeatureInput } from "./schemas";

const SPECS = join(import.meta.dir, "../../../docs/specs");
const specPrefixes = readdirSync(SPECS)
  .filter((f) => f.endsWith(".md"))
  .map((f) => /^prefix:\s*([A-Z]+)\s*$/m.exec(readFileSync(join(SPECS, f), "utf8"))?.[1])
  .filter((p): p is string => p !== undefined);

describe("FR-CAMP-41 registry", () => {
  test("FR-CAMP-41 registry: unique kebab-case keys, known spec prefix, texts ≤ 120; gems first", () => {
    expect(FEATURES[0]?.key).toBe(GEMS_FEATURE);
    expect(new Set(FEATURES.map((f) => f.key)).size).toBe(FEATURES.length);
    for (const f of FEATURES) {
      expect(f.key).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
      expect(specPrefixes).toContain(f.ownerSpec);
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.description.length).toBeLessThanOrEqual(120);
      expect((f.offConfirm ?? "").length).toBeLessThanOrEqual(120);
      expect(featureDef(f.key)).toBe(f);
    }
    expect(featureDef(GEMS_FEATURE)?.label).toBe("Gems (homebrew)");
  });

  test("FR-CAMP-39 key schema: registered keys only; strict input", () => {
    expect(FeatureKey.safeParse("gems").success).toBe(true);
    expect(FeatureKey.safeParse("stats").success).toBe(false);
    expect(SetFeatureInput.safeParse({ feature: "gems", on: true }).success).toBe(true);
    expect(SetFeatureInput.safeParse({ feature: "nope", on: true }).success).toBe(false);
    expect(SetFeatureInput.safeParse({ feature: "gems", on: true, x: 1 }).success).toBe(false);
    expect(SetFeatureInput.safeParse({ feature: "gems" }).success).toBe(false);
  });

  test("FR-CAMP-38 features wire: absent or non-empty; hasFeature reads both", () => {
    const base = { id: "c1", name: "C", dmColor: "#e69f00" };
    expect(CampaignRecord.safeParse(base).success).toBe(true);
    expect(CampaignRecord.safeParse({ ...base, features: ["gems"] }).success).toBe(true);
    expect(CampaignRecord.safeParse({ ...base, features: [] }).success).toBe(false);
    expect(hasFeature(undefined, "gems")).toBe(false);
    expect(hasFeature([], "gems")).toBe(false);
    expect(hasFeature(["gems"], "gems")).toBe(true);
  });
});
