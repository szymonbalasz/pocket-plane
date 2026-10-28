// FR-CHARX-16 / FR-CHARX-56: each field edit re-puts its whole row. A second edit made before the
// first one's echo must build on the first (CI found the damage type lost to a quick Magic pick,
// e2e weapon-rows).
import { expect, test } from "bun:test";
import { rowPutter } from "./rows";

function sender() {
  const sent: Record<string, unknown>[] = [];
  const pending: { ok: () => void; fail: () => void }[] = [];
  const send = (row: Record<string, unknown>) => {
    sent.push(row);
    return new Promise<unknown>((ok, fail) =>
      pending.push({ ok: () => ok(undefined), fail: () => fail(new Error("refused")) }),
    );
  };
  return { sent, pending, send };
}

test("FR-CHARX-56 row edits: a second edit in flight keeps the first (type, then Magic)", async () => {
  const put = rowPutter();
  const s = sender();
  const rendered = { id: "a1", name: "Sword", damage: "2d6+4" };
  const first = put(s.send, rendered, { damageType: "slashing" });
  // Rendered row not yet updated by the echo: the second edit still sees the old row.
  const second = put(s.send, rendered, { bonus: 1 });
  expect(s.sent[1]).toEqual({
    id: "a1",
    name: "Sword",
    damage: "2d6+4",
    damageType: "slashing",
    bonus: 1,
  });
  for (const p of s.pending) p.ok();
  await Promise.all([first, second]);
  // Nothing in flight: the next edit builds on the rendered row again (the echo's).
  put(s.send, { ...rendered, damageType: "fire" }, { name: "Axe" });
  expect(s.sent[2]).toEqual({ id: "a1", name: "Axe", damage: "2d6+4", damageType: "fire" });
});

test("FR-CHARX-56 row edits: undefined clears a field; shape runs on the merged row; a refusal is no base", async () => {
  const put = rowPutter((next) => {
    if (next.roll !== "save") delete next.saveAbility;
  });
  const s = sender();
  const rendered = { id: "s1", roll: "save", saveAbility: "dex", bonus: 2 };
  const a = put(s.send, rendered, { bonus: undefined, roll: "attack" });
  expect(s.sent[0]).toEqual({ id: "s1", roll: "attack" });
  const b = put(s.send, rendered, { name: "Fire Bolt" });
  s.pending[0]?.fail();
  await expect(a).rejects.toThrow("refused");
  // b was built on a (in flight when sent); after a's refusal a new edit builds on b, still in flight.
  put(s.send, rendered, { level: 0 });
  expect(s.sent[2]).toEqual({ id: "s1", roll: "attack", name: "Fire Bolt", level: 0 });
  s.pending[1]?.ok();
  s.pending[2]?.ok();
  await b;
});
