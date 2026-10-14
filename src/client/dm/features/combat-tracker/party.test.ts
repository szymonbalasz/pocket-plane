import { describe, expect, test } from "bun:test";
import { partyMembers, toggleParty } from "./party";

const chars = [{ id: "brin" }, { id: "mira" }, { id: "thorn" }];
const drafts = new Set(["brin"]);
const ids = (cs: { id: string }[]) => cs.map((c) => c.id);

describe("FR-CHARX-11 FR-CBT-02 OQ-CBT-46 encounter party in the editor", () => {
  test("FR-CHARX-11 null = every character but drafts; an explicit list may hold a draft", () => {
    expect(ids(partyMembers(chars, null, drafts))).toEqual(["mira", "thorn"]);
    expect(ids(partyMembers(chars, ["brin", "mira"], drafts))).toEqual(["brin", "mira"]);
    expect(ids(partyMembers(chars, null, new Set()))).toEqual(["brin", "mira", "thorn"]);
  });

  test("FR-CBT-02 ticking a draft makes a list; unticking it again collapses to the whole party", () => {
    const withBrin = toggleParty(chars, null, drafts, "brin", true);
    expect(withBrin).toEqual(["mira", "thorn", "brin"]);
    expect(toggleParty(chars, withBrin, drafts, "brin", false)).toBeNull();
    expect(toggleParty(chars, null, drafts, "thorn", false)).toEqual(["mira"]);
    expect(toggleParty(chars, ["mira"], drafts, "thorn", true)).toBeNull();
  });
});
