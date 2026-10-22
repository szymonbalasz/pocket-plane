// Sprint 8 `cbtx.moveCombatant` (FR-CBTX-64–67, #334 / #335): the DM drops an Initiative row
// right after another (or at the top). One transaction: the numbers the A′ rule changes
// (`planMove`, shared with the DM client's hint), `tieOrder` 1…k on the arranged tie, the ranks,
// `CombatantMoved`. The turn never moves (FR-CBT-164): no turn change, alert, hook or expiry.
// Players get only changed redactions; a hidden row's move sends them nothing (FR-CBTX-67).
import { CBTX_INTENTS, MoveCombatantInput } from "@shared/combat-extras/intents";
import { type MoveRow, ownerRowOf, planMove, ridesOwner } from "@shared/combat-tracker/rules";
import type { CombatantRecord } from "@shared/combat-tracker/schemas";
import { CombatantMoved } from "@shared/events/combat-extras";
import { eq } from "drizzle-orm";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { combatant } from "../../db/schema";
import type { Feature } from "../../services";
import { combatantDiff, rerank } from "../combat-tracker/ranks";
import { campaignOf, combatantsOf, getCombatant, getEncounter } from "../combat-tracker/rows";

const DROP_HERE = "Drop below a row with initiative";

/** FR-CBTX-62: active, not removed, not riding its owner. */
const movable = (rows: readonly CombatantRecord[], r: CombatantRecord) =>
  r.active && !r.removed && !ridesOwner(rows, r);

export const moveCombatant = defineCommand({
  name: CBTX_INTENTS.moveCombatant,
  input: MoveCombatantInput,
  execute({ encounterId, combatantId, afterId }, env): void {
    const { tx } = env;
    const cid = campaignOf(env.actor);
    const enc = getEncounter(tx, cid, encounterId);
    const c = getCombatant(tx, cid, combatantId);
    if (c.encounterId !== enc.id) throw notFound("Combatant not found");
    if (enc.status !== "started") throw conflict("Combat is not running");
    const rows = combatantsOf(tx, enc.id);
    if (!c.active) throw conflict(`${c.name} is not in combat`);
    if (c.removed) throw conflict(`Restore ${c.name} first`);
    if (ridesOwner(rows, c)) {
      throw conflict(`${c.name} moves with ${ownerRowOf(rows, c)?.name ?? "its owner"}`);
    }
    if (afterId !== null) {
      const a = getCombatant(tx, cid, afterId);
      if (a.encounterId !== enc.id) throw notFound("Combatant not found");
      if (a.id === c.id || !movable(rows, a) || a.initiative === null) throw invalid(DROP_HERE);
    }
    const list: MoveRow[] = rows
      .filter((r) => movable(rows, r))
      .sort((x, y) => (x.position ?? 0) - (y.position ?? 0));
    const res = planMove(list, c.id, afterId);
    if (!res.ok) throw res.code === "invalid" ? invalid(res.message) : conflict(res.message);
    // The order stays as it is: ack, no write, no event.
    if (!res.plan) return;
    const { order, numbers, tieValue } = res.plan;
    for (const [id, initiative] of numbers) {
      // FR-CBTX-65: a changed number nulls `initRollId` (as `cbt.setInitiative`); no roll, no line.
      tx.update(combatant).set({ initiative, initRollId: null }).where(eq(combatant.id, id)).run();
    }
    // FR-CBTX-66: every movable row with the arranged number, in the dropped order; others keep theirs.
    const byId = new Map(rows.map((r) => [r.id, r]));
    let k = 0;
    for (const id of order) {
      const r = byId.get(id) as CombatantRecord;
      if ((numbers.get(id) ?? r.initiative) !== tieValue) continue;
      k += 1;
      if (r.tieOrder !== k) {
        tx.update(combatant).set({ tieOrder: k }).where(eq(combatant.id, id)).run();
      }
    }
    rerank(tx, enc.id);
    env.emit({
      type: CombatantMoved.type,
      campaignId: cid,
      payload: {
        encounterId: enc.id,
        combatantId: c.id,
        afterId,
        initiativeBefore: c.initiative,
        initiativeAfter: tieValue,
      },
      changes: combatantDiff(tx, rows),
      // A move players can't see (hidden, fog-hidden, `ownerHidden`) leaves their view as it was:
      // no frame at all, not an empty one (FR-CBTX-67, no timing tell).
      quietWhenUnchanged: true,
    });
  },
});

/** Sprint 8 combat polish (CB0): its own feature line, so combat-extras' index stays as it is. */
export const combatPolish: Feature = {
  name: "combat-polish",
  register(r) {
    r.command(moveCombatant as unknown as CommandDef, { intent: true });
  },
};
