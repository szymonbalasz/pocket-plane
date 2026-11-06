// FR-NOTES-29: the player token menu registry (shaped like the DM's FR-MAP-29 one).
import { describe, expect, test } from "bun:test";
import type { PlayerTokenRecord } from "@shared/scenes-map/schemas";
import { notesTokenMenu } from "../linked-notes/token-menu-entries";
import { playerMenuFor, playerTokenMenuEntries } from "./token-menu";

const token = { id: "t1", name: "Mira", hidden: false, characterId: "c1" } as PlayerTokenRecord;

describe("FR-NOTES-29 player token menu", () => {
  test("FR-NOTES-29 players get a token menu with the note line", () => {
    expect(playerTokenMenuEntries).toEqual(expect.arrayContaining([...notesTokenMenu]));
    expect(playerMenuFor(token).map((e) => e.id)).toEqual(["notes.token-note"]);
  });

  test("FR-NOTES-29 no valid title → no entry, so no menu", () => {
    expect(playerMenuFor({ ...token, name: "  [[]] " })).toEqual([]);
  });

  test("FR-NOTES-29 entries sort by order and drop unavailable ones", () => {
    const Item = () => null;
    const entries = [
      { id: "b", order: 20, Item },
      { id: "a", order: 10, Item },
      { id: "c", order: 5, Item, available: () => false },
    ];
    expect(playerMenuFor(token, entries).map((e) => e.id)).toEqual(["a", "b"]);
  });
});
