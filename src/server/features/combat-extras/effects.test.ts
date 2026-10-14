// CBTX effects, in-process: FR-CBTX-04 add (bulk, duplicate, exhaustion, limits), FR-CBTX-05
// timing, FR-CBTX-08 update / end, FR-CBTX-09 concentration, FR-CBTX-10 links + card closure,
// FR-CBTX-11 incapacitating conditions, FR-CBTX-43 rule closures, rollback.
import { describe, expect, test } from "bun:test";
import { EFFECTS_PER_TARGET_MAX } from "@shared/combat-extras/schemas";
import { updateEffect } from "./effect-commands";
import { cbtxSetup } from "./testing";

describe("FR-CBTX-04 addEffect", () => {
  test("FR-CBTX-04 bulk add 3 conditions; duplicate skipped; one event", () => {
    const t = cbtxSetup();
    const n = t.events.length;
    const r = t.add({
      targets: [
        { combatantId: t.id("Goblin") },
        { combatantId: t.id("Goblin 2") },
        { combatantId: t.id("Wolf") },
      ],
      kind: "condition",
      condition: "frightened",
    });
    expect(r.effectIds).toHaveLength(3);
    expect(t.typesSince(n)).toEqual(["EffectsAdded"]);
    // Again on Goblin + Thorn: Goblin skipped, Thorn (PC → character target) added.
    const again = t.add({
      targets: [{ combatantId: t.id("Goblin") }, { combatantId: t.id("Thorn") }],
      kind: "condition",
      condition: "frightened",
    });
    expect(again.effectIds).toHaveLength(1);
    expect(t.fx(again.effectIds[0] as string)).toMatchObject({
      targetCharacterId: t.thornId,
      targetCombatantId: null,
    });
    // Everything skipped → no event, empty result.
    const m = t.events.length;
    expect(
      t.add({ targets: [{ characterId: t.thornId }], kind: "condition", condition: "frightened" }),
    ).toEqual({ effectIds: [] });
    expect(t.events.length).toBe(m);
  });

  test("FR-CBTX-04 exhaustion: level 1–6 required; re-adding sets the level", () => {
    const t = cbtxSetup();
    const code = (input: unknown) => t.err(() => t.run("cbtx.addEffect", input)).code;
    const target = [{ combatantId: t.id("Goblin") }];
    expect(code({ targets: target, kind: "condition", condition: "exhaustion" })).toBe("invalid");
    expect(code({ targets: target, kind: "condition", condition: "prone", level: 2 })).toBe(
      "invalid",
    );
    expect(code({ targets: target, kind: "custom" })).toBe("invalid");
    expect(code({ targets: target, kind: "custom", label: "  " })).toBe("invalid");
    expect(code({ targets: target, kind: "custom", label: "x".repeat(41) })).toBe("invalid");
    const [id] = t.add({ targets: target, kind: "condition", condition: "exhaustion", level: 2 })
      .effectIds as [string];
    expect(
      t.add({ targets: target, kind: "condition", condition: "exhaustion", level: 4 }),
    ).toEqual({
      effectIds: [id],
    });
    expect(t.fx(id).level).toBe(4);
  });

  test("FR-CBTX-04 limits: 20 per creature, monster refs need the started encounter", () => {
    const t = cbtxSetup();
    for (let i = 0; i < EFFECTS_PER_TARGET_MAX; i++) {
      t.add({ targets: [{ combatantId: t.id("Wolf") }], kind: "custom", label: `E${i}` });
    }
    const over = t.err(() =>
      t.add({ targets: [{ combatantId: t.id("Wolf") }], kind: "custom", label: "one more" }),
    );
    expect(over.code).toBe("conflict");
    const goblin = t.id("Goblin");
    t.endEncounter();
    expect(
      t.err(() => t.add({ targets: [{ combatantId: goblin }], kind: "custom", label: "x" })).code,
    ).toBe("not_found");
    // Characters work outside combat; durations don't.
    expect(
      t.add({ targets: [{ characterId: t.miraId }], kind: "custom", label: "Blessed" }).effectIds,
    ).toHaveLength(1);
    const dur = t.err(() =>
      t.add({
        targets: [{ characterId: t.miraId }],
        kind: "custom",
        label: "x",
        durationRounds: 2,
      }),
    );
    expect([dur.code, dur.message]).toEqual(["conflict", "Durations need a running encounter"]);
  });

  test("FR-CBTX-05 endsRound = max(round, 1) + d; anchor source > turn > target", () => {
    const t = cbtxSetup({ round1: false });
    const [a] = t.add({
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "custom",
      label: "Pre",
      durationRounds: 2,
    }).effectIds as [string];
    // Round 0, no turn combatant → the target's combatant.
    expect(t.fx(a)).toMatchObject({ endsRound: 3, anchorCombatantId: t.id("Goblin") });
    t.step("next"); // round 1, Wolf
    const [b] = t.add({
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "custom",
      label: "Turn",
      durationRounds: 1,
    }).effectIds as [string];
    expect(t.fx(b)).toMatchObject({ endsRound: 2, anchorCombatantId: t.id("Wolf") });
    const [c] = t.add({
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "custom",
      label: "Src",
      durationRounds: 1,
      sourceCombatantId: t.id("Mira"),
    }).effectIds as [string];
    expect(t.fx(c)).toMatchObject({
      endsRound: 2,
      anchorCombatantId: t.id("Mira"),
      sourceName: "Mira",
    });
  });
});

describe("FR-CBTX-09 FR-CBTX-10 FR-CBTX-11 concentration", () => {
  test("FR-CBTX-10 link needs the source's concentration; ending it ends the links", () => {
    const t = cbtxSetup();
    const noConc = t.err(() =>
      t.add({
        targets: [{ combatantId: t.id("Thorn") }],
        kind: "custom",
        label: "Bless",
        sourceCombatantId: t.id("Mira"),
        linkConcentration: true,
      }),
    );
    expect([noConc.code, noConc.message]).toEqual(["conflict", "Mira is not concentrating"]);
    const conc = t.concentrate({ characterId: t.miraId }, "Bless");
    const links = t.add({
      targets: [{ combatantId: t.id("Thorn") }, { combatantId: t.id("Mira") }],
      kind: "custom",
      label: "Bless",
      sourceCombatantId: t.id("Mira"),
      linkConcentration: true,
    }).effectIds;
    expect(links.map((l) => t.fx(l).concentrationId)).toEqual([conc, conc]);
    const n = t.events.length;
    t.end(conc);
    expect(t.typesSince(n)).toEqual(["EffectsEnded"]);
    expect(t.events.at(-1)?.event.payload).toEqual({
      effectIds: [conc, ...links],
      reason: "removed",
    });
    expect([conc, ...links].map((x) => t.fx(x).endedReason)).toEqual([
      "removed",
      "concentration",
      "concentration",
    ]);
  });

  test("FR-CBTX-09 one active per creature: a new one replaces the old (+ its links)", () => {
    const t = cbtxSetup();
    const a = t.concentrate({ characterId: t.miraId }, "Bless");
    const [link] = t.add({
      targets: [{ combatantId: t.id("Thorn") }],
      kind: "custom",
      label: "Bless",
      sourceCombatantId: t.id("Mira"),
      linkConcentration: true,
    }).effectIds as [string];
    const n = t.events.length;
    const b = t.concentrate({ combatantId: t.id("Mira") }, "Shield of Faith");
    expect(t.typesSince(n)).toEqual(["ConcentrationSet"]);
    expect(t.events.at(-1)?.event.payload).toEqual({ effectId: b, replacedId: a });
    expect([t.fx(a).endedReason, t.fx(link).endedReason, t.fx(b).endedAt]).toEqual([
      "replaced",
      "concentration",
      null,
    ]);
  });

  test("FR-CBTX-11 stunned ends concentration + linked; prone is a reminder only", () => {
    const t = cbtxSetup();
    const conc = t.concentrate({ combatantId: t.id("Goblin") }, "Hold Person");
    const [link] = t.add({
      targets: [{ combatantId: t.id("Thorn") }],
      kind: "condition",
      condition: "paralysed",
      sourceCombatantId: t.id("Goblin"),
      linkConcentration: true,
    }).effectIds as [string];
    t.add({ targets: [{ combatantId: t.id("Goblin") }], kind: "condition", condition: "prone" });
    expect(t.fx(conc).endedAt).toBeNull();
    t.add({ targets: [{ combatantId: t.id("Goblin") }], kind: "condition", condition: "stunned" });
    expect([t.fx(conc).endedReason, t.fx(link).endedReason]).toEqual([
      "incapacitated",
      "concentration",
    ]);
  });

  test("FR-CBTX-08 update: level, duration from now, secret; end: DM any, player own concentration only", () => {
    const t = cbtxSetup();
    const [hex] = t.add({
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "custom",
      label: "Hex",
    }).effectIds as [string];
    t.run(updateEffect.name, { effectId: hex, durationRounds: 3, secret: true });
    expect(t.fx(hex)).toMatchObject({ durationRounds: 3, endsRound: 4, secret: true });
    t.run(updateEffect.name, { effectId: hex, durationRounds: null });
    expect(t.fx(hex)).toMatchObject({ durationRounds: null, endsRound: null });
    const n = t.events.length;
    t.run(updateEffect.name, { effectId: hex, secret: true });
    expect(t.events.length).toBe(n);
    expect(t.err(() => t.run(updateEffect.name, { effectId: hex, level: 2 })).code).toBe("invalid");
    // Players: a secret effect is invisible (not_found); Mira's Bless isn't theirs to end.
    expect(t.err(() => t.end(hex, t.p1)).code).toBe("not_found");
    const [marked] = t.add({
      targets: [{ characterId: t.miraId }],
      kind: "custom",
      label: "Marked",
    }).effectIds as [string];
    expect(t.err(() => t.end(marked, t.p1)).code).toBe("forbidden");
    const conc = t.concentrate({ characterId: t.miraId }, "Bless", undefined, t.p1);
    expect(t.err(() => t.end(conc, t.p2)).code).toBe("forbidden");
    t.end(conc, t.p1);
    expect(t.fx(conc).endedReason).toBe("removed");
    expect(t.err(() => t.end(conc)).code).toBe("conflict");
    // Players can't concentrate for someone else or via a combatant ref.
    expect(t.err(() => t.concentrate({ characterId: t.thornId }, "X", undefined, t.p1)).code).toBe(
      "forbidden",
    );
    expect(
      t.err(() => t.concentrate({ combatantId: t.id("Mira") }, "X", undefined, t.p1)).code,
    ).toBe("forbidden");
    expect(
      t.err(() => t.add({ targets: [{ characterId: t.miraId }], kind: "custom", label: "x" }, t.p1))
        .code,
    ).toBe("forbidden");
  });
});

describe("FR-CBTX-43 rule closures", () => {
  test("FR-CBTX-43 hidden PC's card (owner DM): player ends own concentration → card closed ended, no forbidden", () => {
    const t = cbtxSetup();
    // Hide Mira's token: her combatant is hidden, so her card goes to the DM (#141).
    t.run("map.setTokenHidden", { tokenId: t.tokens.mira, hidden: true });
    const conc = t.concentrate({ characterId: t.miraId }, "Bless");
    t.attackApply("Goblin", ["Mira"], 3);
    const [card] = t.cards();
    expect(card).toMatchObject({ audience: "dm", actionRole: "dm", state: "pending" });
    const n = t.events.length;
    t.end(conc, t.p1);
    expect(t.typesSince(n)).toEqual(["EffectsEnded", "NotificationResolved"]);
    expect(t.note(card?.id as string)).toMatchObject({
      state: "resolved",
      resolution: { outcome: "ended" },
      closedByRole: "player",
    });
  });

  test("rollback: a throwing token hook leaves no effect and no event", () => {
    const t = cbtxSetup();
    const before = t.effects().length;
    const n = t.events.length;
    expect(
      t.err(() =>
        t.add({
          targets: [{ combatantId: t.id("Goblin") }, { combatantId: "nope" }],
          kind: "condition",
          condition: "prone",
        }),
      ).code,
    ).toBe("not_found");
    expect([t.effects().length, t.events.length]).toEqual([before, n]);
  });
});
