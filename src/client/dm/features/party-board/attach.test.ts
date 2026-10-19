import { describe, expect, test } from "bun:test";
import { attachImage } from "./attach";

describe("FR-PARTY-39 editor attachments", () => {
  test("FR-PARTY-39 paste adds an image: appended in order; an id already in the strip is not added", () => {
    const one = attachImage([], "A");
    expect(one).toEqual({ ids: ["A"], duplicate: false });
    const two = attachImage(one.ids, "B");
    expect(two).toEqual({ ids: ["A", "B"], duplicate: false });
    const again = attachImage(two.ids, "A");
    expect(again).toEqual({ ids: ["A", "B"], duplicate: true });
    // The caller's list is never mutated.
    expect(one.ids).toEqual(["A"]);
  });
});
