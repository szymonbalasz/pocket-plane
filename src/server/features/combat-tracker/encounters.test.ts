import { describe, expect, test } from "bun:test";
import {
  ENCOUNTER_ENTRY_TYPE,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { createApp } from "../../app";
import { TEST_SECRET } from "../../testing/services";
import { createEncounter, deleteEncounter, updateEncounter } from "./encounters";
import { combatSetup } from "./testing";

describe("FR-CBT-01 FR-CBT-02 encounter prep", () => {
  test("FR-CBT-01 create: trimmed name, merged duplicates, entries, event + log in one tx", () => {
    const t = combatSetup();
    const e = t.run<EncounterRecord>(createEncounter.name, {
      name: "  Ford  ",
      partyCharacterIds: null,
      entries: [
        { definitionId: t.h.goblinId, quantity: 1 },
        { definitionId: t.h.wolfId, quantity: 1 },
        { definitionId: t.h.goblinId, quantity: 2 },
      ],
    });
    expect(e).toMatchObject({ name: "Ford", status: "planned", round: 0, partyCharacterIds: null });
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("EncounterCreated");
    const entries = ev?.changes.filter((c) => c.type === ENCOUNTER_ENTRY_TYPE) ?? [];
    expect(entries.map((c) => c.after)).toMatchObject([
      { definitionId: t.h.goblinId, quantity: 3, campaignId: t.h.campaignId },
      { definitionId: t.h.wolfId, quantity: 1 },
    ]);
    expect(t.logTypes().at(-1)).toBe("EncounterCreated");
  });

  test("FR-CBT-01 rejects: bad name, character entry, too many, unknown definition", () => {
    const t = combatSetup();
    const base = { name: "X", partyCharacterIds: null, entries: [] };
    const before = t.count("encounter");
    expect(t.err(() => t.run(createEncounter.name, { ...base, name: " " })).code).toBe("invalid");
    expect(t.err(() => t.run(createEncounter.name, { ...base, name: "a\u0007" })).code).toBe(
      "invalid",
    );
    expect(t.err(() => t.run(createEncounter.name, { ...base, name: "x".repeat(61) })).code).toBe(
      "invalid",
    );
    expect(
      t.err(() =>
        t.run(createEncounter.name, {
          ...base,
          entries: [{ definitionId: t.miraId, quantity: 1 }],
        }),
      ).code,
    ).toBe("invalid");
    expect(
      t.err(() =>
        t.run(createEncounter.name, {
          ...base,
          entries: [
            { definitionId: t.h.goblinId, quantity: 20 },
            { definitionId: t.h.wolfId, quantity: 20 },
            { definitionId: t.eliteId, quantity: 11 },
          ],
        }),
      ).code,
    ).toBe("invalid");
    expect(
      t.err(() =>
        t.run(createEncounter.name, {
          ...base,
          entries: [
            { definitionId: t.h.goblinId, quantity: 15 },
            { definitionId: t.h.goblinId, quantity: 15 },
          ],
        }),
      ).code,
    ).toBe("invalid");
    expect(
      t.err(() =>
        t.run(createEncounter.name, { ...base, entries: [{ definitionId: "nope", quantity: 1 }] }),
      ).code,
    ).toBe("not_found");
    expect(t.count("encounter")).toBe(before);
  });

  test("FR-CBT-01 ≤ 30 non-ended encounters per campaign → conflict", () => {
    const t = combatSetup();
    for (let i = 0; i < 30; i++) {
      t.run(createEncounter.name, { name: `E${i}`, partyCharacterIds: null, entries: [] });
    }
    const e = t.err(() =>
      t.run(createEncounter.name, { name: "E31", partyCharacterIds: null, entries: [] }),
    );
    expect(e.code).toBe("conflict");
  });

  test("FR-CBT-02 party list: characters of the campaign only", () => {
    const t = combatSetup();
    const e = t.run<EncounterRecord>(createEncounter.name, {
      name: "P",
      partyCharacterIds: [t.miraId, t.miraId],
      entries: [],
    });
    expect(e.partyCharacterIds).toEqual([t.miraId]);
    for (const bad of [t.h.goblinId, "nope"]) {
      expect(
        t.err(() =>
          t.run(createEncounter.name, { name: "P", partyCharacterIds: [bad], entries: [] }),
        ).code,
      ).toBe("invalid");
    }
  });

  test("FR-CBT-01 update = whole replace; delete; both planned only", () => {
    const t = combatSetup();
    const e = t.createAmbush();
    const u = t.run<EncounterRecord>(updateEncounter.name, {
      id: e.id,
      name: "Renamed",
      partyCharacterIds: [t.thornId],
      entries: [{ definitionId: t.h.wolfId, quantity: 2 }],
    });
    expect(u).toMatchObject({ name: "Renamed", partyCharacterIds: [t.thornId] });
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("EncounterUpdated");
    const entryChanges = ev?.changes.filter((c) => c.type === ENCOUNTER_ENTRY_TYPE) ?? [];
    expect(entryChanges.filter((c) => c.after === null)).toHaveLength(3);
    expect(entryChanges.filter((c) => c.before === null)).toHaveLength(1);
    t.run(deleteEncounter.name, { id: e.id });
    expect(t.events.at(-1)?.event.type).toBe("EncounterDeleted");
    expect(t.count("encounter")).toBe(0);
    expect(t.count("encounter_entry")).toBe(0);
    expect(t.err(() => t.run(deleteEncounter.name, { id: e.id })).code).toBe("not_found");
  });

  test("FR-CBT-27 planned encounter + entries: DM only; players see nothing", () => {
    const t = combatSetup();
    t.createAmbush();
    const dm = t.h.snapshot(t.h.viewer("dm"));
    expect(dm[ENCOUNTER_TYPE]).toHaveLength(1);
    expect(dm[ENCOUNTER_ENTRY_TYPE]).toHaveLength(3);
    const pl = t.h.snapshot(t.h.viewer("player", t.h.p1.id));
    expect(pl[ENCOUNTER_TYPE]).toEqual([]);
    expect(pl[ENCOUNTER_ENTRY_TYPE]).toBeUndefined();
    // Another campaign's DM sees none of it.
    expect(t.h.snapshot(t.h.viewer("dm", null, t.h.secondCampaignId))[ENCOUNTER_TYPE]).toEqual([]);
  });

  test("FR-CBT-01 REST: 201 create, 200 replace, 204 delete, 401 without secret", async () => {
    const t = combatSetup();
    const app = createApp(t.s);
    const auth = { authorization: `Bearer ${TEST_SECRET}`, "content-type": "application/json" };
    const body = JSON.stringify({
      name: "Ford",
      partyCharacterIds: null,
      entries: [{ definitionId: t.h.goblinId, quantity: 2 }],
    });
    const noAuth = await app.request("/api/encounters", { method: "POST", body });
    expect(noAuth.status).toBe(401);
    const created = await app.request("/api/encounters", { method: "POST", headers: auth, body });
    expect(created.status).toBe(201);
    const { encounter } = (await created.json()) as { encounter: EncounterRecord };
    const put = await app.request(`/api/encounters/${encounter.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ name: "Ford 2", partyCharacterIds: null, entries: [] }),
    });
    expect(put.status).toBe(200);
    const bad = await app.request(`/api/encounters/${encounter.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ name: "", partyCharacterIds: null, entries: [] }),
    });
    expect(bad.status).toBe(400);
    const del = await app.request(`/api/encounters/${encounter.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(del.status).toBe(204);
  });
});
