// FR-MOD-28 DM entry points for rule triggers: token menu "Rule triggers…" (monster token → its
// definition, PC token → its character) and the Creatures window row action (monster rows).
import { describe, expect, test } from "bun:test";
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { creatureActions } from "../entities/creature-actions";
import type { CreatureRow } from "../entities/list";
import { tokenMenuEntries } from "../scenes-map/token-menu";
import { modCreatureTriggersAction, tokenTriggerOwner } from "./triggers-dialog";

const store: RecordStore = {
  ...emptyStore(),
  records: {
    [ENTITY_TYPE]: {
      brakka: { id: "brakka", kind: "character", name: "Brakka" },
      boss: { id: "boss", kind: "monster", name: "Boss" },
    },
    [IMPORTED_ENTITY_TYPE]: { "srd-wolf": { id: "srd-wolf", kind: "monster", name: "Wolf" } },
  },
};
const token = (o: Partial<TokenRecord>) =>
  ({ id: "t", characterId: null, definitionId: "boss", ...o }) as TokenRecord;

describe("FR-MOD-28 rule trigger entries", () => {
  test("FR-MOD-28 token → owner: PC → its character; monster (custom / imported) → its definition", () => {
    expect(
      tokenTriggerOwner(store, token({ characterId: "brakka", definitionId: "brakka" })),
    ).toEqual({ kind: "character", id: "brakka" });
    expect(tokenTriggerOwner(store, token({}))).toEqual({ kind: "definition", id: "boss" });
    expect(tokenTriggerOwner(store, token({ definitionId: "srd-wolf" }))).toEqual({
      kind: "definition",
      id: "srd-wolf",
    });
    expect(tokenTriggerOwner(store, token({ definitionId: "unknown" }))).toBeNull();
  });

  test("FR-MOD-28 registered: token menu 'mod.triggers' (with a Dialog), Creatures row action 'mod.triggers'", () => {
    const entry = tokenMenuEntries.find((e) => e.id === "mod.triggers");
    expect(entry?.Dialog).toBeDefined();
    expect(creatureActions).toContain(modCreatureTriggersAction);
    expect(modCreatureTriggersAction.placement).toBe("row");
  });

  test("FR-MOD-28 Creatures row action: monster rows only (any definition)", () => {
    const Row = modCreatureTriggersAction.component as (p: {
      row: CreatureRow;
    }) => ReactElement | null;
    const row = (kind: "monster" | "character", readOnly: boolean) =>
      ({ id: "d1", kind, name: "Wolf", readOnly }) as CreatureRow;
    for (const readOnly of [true, false]) {
      expect(renderToStaticMarkup(<Row row={row("monster", readOnly)} />)).toContain(
        'data-testid="mod-creature-triggers" data-record-id="d1"',
      );
    }
    expect(renderToStaticMarkup(<Row row={row("character", false)} />)).not.toContain(
      "mod-creature-triggers",
    );
  });
});
