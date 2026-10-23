// Sprint 10, H1 (BL-97): the Add dialog's preview shows a bound visible monster token as hidden
// when Add hidden is ticked (the server hides it, FR-CBTX-44); PCs, pets and Start unchanged.
import { describe, expect, test } from "bun:test";
import { type JoinSlot, previewJoin } from "../combat-tracker/join-preview";

const slot = (kind: "monster" | "pc", entityId: string, name: string, pet = false): JoinSlot => ({
  kind,
  entityId,
  name,
  portraitAssetId: null,
  hpMode: "average",
  hasFormula: true,
  ...(pet ? { pet } : {}),
});
const tok = (id: string, seq: number, definitionId: string, name: string) => ({
  id,
  seq,
  definitionId,
  name,
  imageAssetId: null,
  hidden: false,
});

describe("BL-97 FR-CBTX-44 Add preview", () => {
  const tokens = [
    tok("t-elite2", 1, "elite", "Elite Goblin Warrior 2"),
    tok("t-mira", 2, "mira", "Mira"),
    tok("t-drake", 3, "drake", "Drake"),
  ];
  const slots = [slot("monster", "elite", "Elite"), slot("pc", "mira", "Mira")];
  const pet = slot("monster", "drake", "Drake", true);
  const opts = { createTokens: true, sceneTokenNames: tokens.map((t) => t.name) };

  test("FR-CBTX-44 Add hidden → a bound visible monster token previews hidden; PC and pet keep theirs", () => {
    const rows = previewJoin([...slots, pet], tokens, { ...opts, hidden: true, hideBound: true });
    expect(rows.map((r) => [r.name, r.binding, r.hidden])).toEqual([
      ["Elite Goblin Warrior 2", "token", true],
      ["Mira", "token", false],
      ["Drake", "token", false],
    ]);
  });

  test("FR-CBTX-44 Add hidden off, or Start's preview → the token's own flag", () => {
    const off = previewJoin(slots, tokens, { ...opts, hidden: false, hideBound: true });
    const start = previewJoin(slots, tokens, { ...opts, hidden: true });
    for (const rows of [off, start]) expect(rows[0]?.hidden).toBe(false);
  });
});
