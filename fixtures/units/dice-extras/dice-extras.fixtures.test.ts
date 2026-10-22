import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import {
  creatureSheet,
  diceLook,
  entity,
  notification,
  player,
  rollMacro,
  rollRequest,
} from "@server/db/schema";
import { CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { defaultLook, lookOf } from "@shared/dice-extras/looks";
import { findNotation } from "@shared/dice-extras/notation";
import { ROLL_REQUEST_KIND } from "@shared/dice-extras/requests";
import { eq } from "drizzle-orm";
import { loadBundle } from "../../index";
import { DICEX_LOOKS } from "./dicex-looks";
import { DICEX_MACROS } from "./dicex-macros";
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
    expect(r.manifest.fixtures.slice(-3)).toEqual([
      "char-mira-full",
      "dicex-looks",
      "dicex-notation-text",
    ]);
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

  test("FR-DICEX-24 FR-DICEX-26 bundle dice-extras: DM Obsidian metal, player-1 Crimson metal, player-2 default Sapphire", async () => {
    const r = await loadBundle("dice-extras", { testMode: true });
    cleanups.push(r.cleanup);
    expect(r.manifest.status).toBe("complete");
    const db = r.openDb();
    const rows = db.select().from(diceLook).all();
    const players = db.select().from(player).all();
    closeDb(db);
    const p1 = players.find((p) => p.name === "Player 1")?.id as string;
    const p2 = players.find((p) => p.name === "Player 2")?.id as string;
    expect(rows.map((x) => x.ownerKey).sort()).toEqual(["dm", p1].sort());
    const ids = players.map((p) => p.id);
    expect(lookOf(null, rows, ids)).toEqual(DICEX_LOOKS.dm);
    expect(lookOf(p1, rows, ids)).toEqual(DICEX_LOOKS.player1);
    expect(lookOf(p2, rows, ids)).toEqual(defaultLook(p2, ids));
    expect(lookOf(p2, rows, ids).style).toBe("sapphire");
    expect(rows.find((x) => x.ownerKey === p1)?.ownerPlayerId).toBe(p1);
  });

  test("FR-DICEX-64 FR-DICEX-74 bundle table-tools loads from empty: five macros, one open hidden Perception to Mira + Thorn", async () => {
    const r = await loadBundle("table-tools", { testMode: true });
    cleanups.push(r.cleanup);
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-4)).toEqual([
      "dicex-macros",
      "audio-chime",
      "camp-alert-sounds",
      "dicex-request-open",
    ]);
    const db = r.openDb();
    const players = db.select().from(player).all();
    const macros = db.select().from(rollMacro).all();
    const reqs = db.select().from(rollRequest).all();
    const prompts = db
      .select()
      .from(notification)
      .where(eq(notification.kind, ROLL_REQUEST_KIND))
      .all();
    closeDb(db);
    const p1 = players.find((p) => p.name === "Player 1")?.id as string;
    const p2 = players.find((p) => p.name === "Player 2")?.id as string;
    const who = (name: string) => macros.find((m) => m.name === name);
    expect(macros).toHaveLength(5);
    expect(who(DICEX_MACROS.sneak)).toMatchObject({
      playerId: p1,
      createdBy: p1,
      expression: "3d6",
    });
    expect(who(DICEX_MACROS.luck)).toMatchObject({ playerId: p1, creatureId: null });
    expect(who(DICEX_MACROS.bless)).toMatchObject({ playerId: null, createdBy: null });
    expect(who(DICEX_MACROS.inspiration)).toMatchObject({ playerId: p2, createdBy: null });
    expect(who(DICEX_MACROS.ambush)).toMatchObject({ playerId: null, expression: "2d6" });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ label: "Perception", dc: 15, dcShown: false, state: "open" });
    expect(prompts.map((n) => [n.audiencePlayerId, n.state, n.text])).toEqual([
      [p1, "pending", "DM: Perception · Mira"],
      [p2, "pending", "DM: Perception · Thorn"],
    ]);
    expect(prompts.every((n) => (n.payload as { dc: number | null }).dc === null)).toBe(true);
  }, 120_000);
});
