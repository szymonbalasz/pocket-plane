// FR-NOTE-52 (sprint 8, WF4; seams S3, S13): every registered kind names its toast class
// (pending → card, else info); the registry refuses an unknown one.
// The helpers first: `kinds.ts` as the entry point would meet the kinds → notify → helpers cycle.
import "./helpers";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildKindMap, defineNotificationKind } from "./kind";
import { notificationKinds } from "./kinds";

/** The registry's classes (FR-NOTE-52); a kind added to `kinds.ts` adds its line here. */
const EXPECTED: Record<string, string> = {
  test: "info",
  "damage-card": "card",
  "loot-received": "info",
  "cbtx-concentration": "card",
  "charx-draft": "card",
  "charx-approved": "info",
  "mod-trigger": "info",
  "handout-shared": "info",
  "cbt-summon-concentration": "card",
  "stats-awards": "info",
  "roll-request": "card",
};

describe("FR-NOTE-52 toast classes", () => {
  test("FR-NOTE-52 toast classes: every kinds.ts entry names its class; pending kinds are cards (TT roll-request = card)", () => {
    const map = buildKindMap(notificationKinds);
    const got = Object.fromEntries([...map].map(([k, d]) => [k, d.toastClass]));
    for (const [kind, cls] of Object.entries(EXPECTED))
      expect([kind, got[kind]]).toEqual([kind, cls]);
    for (const d of notificationKinds) expect(["card", "alert", "info"]).toContain(d.toastClass);
    expect(Object.keys(got).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  test("FR-NOTE-52 toast classes: an unknown class fails at load; absent is allowed (by state)", () => {
    const k = (toastClass?: string) =>
      defineNotificationKind({
        kind: "x",
        ownerSpec: "x",
        payload: z.object({}),
        ...(toastClass ? { toastClass: toastClass as "info" } : {}),
      });
    expect(() => buildKindMap([k("callout")])).toThrow(/unknown toast class/);
    expect(() => buildKindMap([k()])).not.toThrow();
    expect(buildKindMap([k("alert")]).get("x")?.toastClass).toBe("alert");
  });
});
