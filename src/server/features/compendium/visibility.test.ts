import { describe, expect, test } from "bun:test";
import { COMPENDIUM_KINDS, type CompendiumKind } from "@shared/compendium/schemas";
import { type EntryViewer, entryVisibleTo } from "./visibility";

const DM: EntryViewer = { role: "dm", campaignId: "camp", playerId: null };
const P1: EntryViewer = { role: "player", campaignId: "camp", playerId: "p1" };

const ORIGINS = {
  imported: { campaignId: null, shared: false },
  ownShared: { campaignId: "camp", shared: true },
  ownHidden: { campaignId: "camp", shared: false },
  otherCampaign: { campaignId: "other", shared: true },
} as const;
type Origin = keyof typeof ORIGINS;

/** FR-CMP-14 expected: who sees what (homebrew monsters don't exist, but the fn still answers). */
function expected(v: EntryViewer, kind: CompendiumKind, o: Origin): boolean {
  if (o === "otherCampaign") return false;
  if (v.role === "dm") return true;
  if (kind === "monster") return false;
  return o !== "ownHidden";
}

describe("FR-CMP-14 entryVisibleTo", () => {
  test("FR-CMP-14 entryVisibleTo matrix: DM / player × 5 kinds × imported / own shared / own hidden / other campaign", () => {
    const got: string[] = [];
    const want: string[] = [];
    for (const v of [DM, P1]) {
      for (const kind of COMPENDIUM_KINDS) {
        for (const o of Object.keys(ORIGINS) as Origin[]) {
          const key = `${v.role} ${kind} ${o}`;
          got.push(`${key}: ${entryVisibleTo({ kind, ...ORIGINS[o] }, v)}`);
          want.push(`${key}: ${expected(v, kind, o)}`);
        }
      }
    }
    expect(got).toEqual(want);
    expect(got).toHaveLength(2 * 5 * 4);
  });

  test("FR-CMP-14 a player of another campaign never sees this campaign's shared homebrew", () => {
    const other: EntryViewer = { role: "player", campaignId: "other", playerId: "p9" };
    expect(entryVisibleTo({ kind: "item", campaignId: "camp", shared: true }, other)).toBe(false);
    expect(entryVisibleTo({ kind: "item", campaignId: null, shared: false }, other)).toBe(true);
  });
});
