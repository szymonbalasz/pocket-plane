// FR-SHARE-04, -05, -06: what a share says, and how its line and row read it.
import { describe, expect, test } from "bun:test";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { copyText, rowAction, rowResults, shareOf } from "@shared/dice-roll-log/row";
import { FOLDED_TEXT } from "./kind";
import { LOG_KIND_SHARE, SHARE_TEXT_MAX, SHARE_TITLE_MAX, SharePayload } from "./schemas";
import { attackShareLine, entryShareText, sharePayload, withNotes } from "./text";

const entry = (payload: object) => ({ kind: LOG_KIND_SHARE, actorName: "Mira", payload });

describe("FR-SHARE-04 the text of a share", () => {
  test("FR-SHARE-04 a spell: its facts, its text, At Higher Levels", () => {
    const text = entryShareText({
      kind: "spell",
      body: {
        castingTime: "1 action",
        range: "150 feet",
        components: "V, S, M",
        material: "a tiny ball of bat guano",
        duration: "Instantaneous",
        text: "A bright streak flashes.",
        higherLevel: "+1d6 per slot.",
      },
    });
    expect(text).toBe(
      "**Casting Time:** 1 action\n**Range:** 150 feet\n**Components:** V, S, M (a tiny ball of bat guano)\n**Duration:** Instantaneous\n\nA bright streak flashes.\n\n**At Higher Levels.** +1d6 per slot.",
    );
  });

  test("FR-SHARE-04 an item: only the facts it has, then its text", () => {
    expect(
      entryShareText({
        kind: "item",
        body: { typeLine: "Wondrous item", weight: "1 lb.", text: "It sheds dim light." },
      }),
    ).toBe("**Weight:** 1 lb.\n\nIt sheds dim light.");
  });

  test("FR-SHARE-04 condition, feature and rule: the text as it stands", () => {
    for (const kind of ["condition", "feature", "rule"] as const) {
      expect(entryShareText({ kind, body: { text: " Words. " } })).toBe("Words.");
    }
  });

  test("FR-SHARE-10 a monster has no share text", () => {
    expect(() => entryShareText({ kind: "monster", body: {} })).toThrow();
  });

  test("FR-SHARE-04 a row's notes follow the looked-up text; empty parts leave no gap", () => {
    expect(withNotes("Text.", "Mine.")).toBe("Text.\n\n**Notes.** Mine.");
    expect(withNotes("", "Mine.")).toBe("**Notes.** Mine.");
    expect(withNotes("Text.", "  ")).toBe("Text.");
  });

  test("FR-SHARE-04 an attack row reads as the sheet's line, magic included", () => {
    expect(
      attackShareLine({
        name: "Longsword",
        toHit: 7,
        damage: "2d6+4",
        damageType: "slashing",
        bonus: 1,
        extraDamage: [{ damage: "2d6", type: "fire" }],
      }),
    ).toBe("+8 · 2d6+5 slashing + 2d6 fire");
    expect(attackShareLine({ name: "Rock", toHit: -1, damage: "1d4" })).toBe("-1 · 1d4");
  });
});

describe("FR-SHARE-06 limits", () => {
  test("FR-SHARE-06 a text past the limit is cut with an ellipsis and marked; the payload stays valid", () => {
    const p = sharePayload({ title: "T", line: "", text: "x".repeat(SHARE_TEXT_MAX + 50) });
    expect(p.cut).toBe(true);
    expect(p.text.length).toBe(SHARE_TEXT_MAX);
    expect(p.text.endsWith("…")).toBe(true);
    expect(SharePayload.safeParse(p).success).toBe(true);
  });

  test("FR-SHARE-06 a text at the limit stays whole; a long title is clipped", () => {
    const p = sharePayload({
      title: "n".repeat(SHARE_TITLE_MAX + 5),
      line: "",
      text: "y".repeat(SHARE_TEXT_MAX),
    });
    expect(p.cut).toBeUndefined();
    expect(p.text.length).toBe(SHARE_TEXT_MAX);
    expect(p.title.length).toBe(SHARE_TITLE_MAX);
  });
});

describe("FR-SHARE-05 the line and the row", () => {
  const p = { title: "Fireball", line: "Level 3 evocation", text: "A bright streak." };

  test("FR-SHARE-05 the row's head is short; the copied line holds the whole text", () => {
    expect(rowAction(entry(p))).toEqual({ actor: "Mira", text: "shares Fireball" });
    expect(rowResults(entry(p))).toEqual([]);
    expect(copyText(formatEntry(entry(p)).segments)).toBe(
      "Mira shares Fireball (Level 3 evocation)\nA bright streak.",
    );
  });

  test("FR-SHARE-08 a folded share says so instead of its text", () => {
    const folded = { title: "Fireball", line: "", text: "", folded: true };
    expect(lineText(formatEntry(entry(folded)).segments)).toBe(
      `Mira shares Fireball\n${FOLDED_TEXT}`,
    );
  });

  test("FR-SHARE-05 shareOf: only a readable share", () => {
    expect(shareOf(entry(p))?.title).toBe("Fireball");
    expect(shareOf({ kind: "roll", payload: p })).toBeNull();
    expect(shareOf({ kind: LOG_KIND_SHARE, payload: { nope: 1 } })).toBeNull();
  });
});
