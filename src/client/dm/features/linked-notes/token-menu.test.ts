// FR-NOTES-29: the notes line in the DM token menu registry (FR-MAP-29).
import { describe, expect, test } from "bun:test";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { menuFor, tokenMenuEntries } from "../scenes-map/token-menu";
import { notesTokenMenu } from "./token-menu-entries";

const token = { id: "t1", name: "Goblin", hidden: false, characterId: null } as TokenRecord;

describe("FR-NOTES-29 DM token menu line", () => {
  test("FR-NOTES-29 the note line is in the DM menu, after Stat block, with a dialog for hidden tokens", () => {
    expect(tokenMenuEntries).toEqual(expect.arrayContaining([...notesTokenMenu]));
    const ids = menuFor(token).map((e) => e.id);
    expect(ids).toContain("notes.token-note");
    expect(ids.indexOf("notes.token-note")).toBeLessThan(ids.indexOf("map.hide"));
    expect(notesTokenMenu[0]?.Dialog).toBeDefined();
  });

  test("FR-NOTES-29 a name with no valid title left shows no line", () => {
    expect(menuFor({ ...token, name: "[[ | ]]" }).map((e) => e.id)).not.toContain(
      "notes.token-note",
    );
  });
});
