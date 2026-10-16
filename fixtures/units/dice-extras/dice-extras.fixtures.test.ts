import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { creatureSheet, entity } from "@server/db/schema";
import { CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { findNotation } from "@shared/dice-extras/notation";
import { eq } from "drizzle-orm";
import { loadBundle } from "../../index";
import { NOTATION_TEXT } from "./dicex-notation-text";

const cleanups: (() => void)[] = [];
afterAll(() => {
  for (const c of cleanups) c();
});

describe("dice-extras fixtures (DICEX §13)", () => {
  test("FR-DICEX-28 bundle dice-extras loads from empty: Mira's new 'Notation test' feature, notes untouched", async () => {
    const r = await loadBundle("dice-extras", { testMode: true });
    cleanups.push(r.cleanup);
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-2)).toEqual(["char-mira-full", "dicex-notation-text"]);
    const db = r.openDb();
    const mira = db.select().from(entity).where(eq(entity.name, "Mira")).get();
    const row = db
      .select()
      .from(creatureSheet)
      .where(eq(creatureSheet.entityId, mira?.id ?? ""))
      .get();
    closeDb(db);
    const sheet = CreatureSheetRecord.parse({ id: row?.entityId, ...row });
    const features = sheet.features.map((f) => f.name);
    expect(features).toEqual(["Second Wind", "Fighting Style", "Notation test"]);
    const text = sheet.features.find((f) => f.name === "Notation test");
    expect(text).toMatchObject({ source: "fixture", text: NOTATION_TEXT });
    expect(sheet.notes).toBe("MIRA-NOTE-7");
    expect(findNotation(NOTATION_TEXT).map((m) => m.expression)).toEqual([
      "1d12+5",
      "1d10+1",
      "2d6-1",
      "1d20+3",
    ]);
  });
});
