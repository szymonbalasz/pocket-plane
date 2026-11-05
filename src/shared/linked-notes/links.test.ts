// NOTES N5 unit (build §1.2): `parseLinks`: `[[T]]`, `[[T|l]]`, malformed links; `@Duke` alone is
// not a link (FR-NOTES-07, -08).
import { describe, expect, test } from "bun:test";
import { linkFolds, linkText, parseLinks } from "./links";

describe("linked-notes parseLinks (N5)", () => {
  test("FR-NOTES-07 [[Title]] and [[Title|label]] link; offsets, label and folded target", () => {
    const text = "Found in [[Duke Varen]]'s office. See [[Quest log|the log]].";
    expect(parseLinks(text)).toEqual([
      { from: 9, to: 23, target: "Duke Varen", label: null, fold: "duke varen" },
      { from: 38, to: 59, target: "Quest log", label: "the log", fold: "quest log" },
    ]);
    expect(text.slice(9, 23)).toBe("[[Duke Varen]]");
    expect(parseLinks("[[ Duke  Varen |  ]]")[0]).toMatchObject({
      target: "Duke  Varen",
      label: null,
    });
  });

  test("FR-NOTES-07 FR-NOTES-08 malformed links and @ mentions stay plain text", () => {
    for (const plain of [
      "@Duke",
      "@Duke Varen owes money",
      "[Duke Varen]",
      "[[Duke Varen]",
      "[[Duke\nVaren]]",
      "[[]]",
      "[[   ]]",
      `[[${"x".repeat(101)}]]`,
      "[[a|b|c]]",
      "[[a [[b]]".slice(0, 5),
    ])
      expect([plain, parseLinks(plain)]).toEqual([plain, []]);
    // A nested opener: only the inner, well-formed link counts.
    expect(parseLinks("[[a [[Duke]]").map((l) => l.target)).toEqual(["Duke"]);
  });

  test("FR-NOTES-07 link folds are distinct and folded; the picker's text", () => {
    expect(linkFolds("[[Quest Log]] and [[quest-log|q]] and [[Duke]]")).toEqual([
      "duke",
      "quest log",
    ]);
    expect(linkText("Duke Varen")).toBe("[[Duke Varen]]");
  });
});
