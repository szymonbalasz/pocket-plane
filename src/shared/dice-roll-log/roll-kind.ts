// The `roll` log-entry kind (FR-DICE-20): "<actor> — <label or expression>: <dice> + <constants>
// = <total>" per roll; "(adv)" / "(dis)" with the dropped die struck through; natural 20 / 1;
// "physical" for manual rolls. Other kinds may reuse `rollSegments` for their roll parts.
import { parseExpression } from "./grammar";
import { defineLogKind, type LineSegment } from "./kind-types";
import { RollEntryPayload, type RollPayloadItem } from "./schemas";

export const ROLL_KIND = "roll";

/** Dice values of one roll, grouped per dice term in notation order. */
function diceSegments(item: RollPayloadItem): LineSegment[] {
  const parsed = parseExpression(item.expression);
  const allNull = item.dice.length > 0 && item.dice.every((d) => d.value === null);
  if (allNull || !parsed.ok) {
    // Manual total of several dice (values unknown), or an unparsable stored expression.
    if (item.dice.length === 0) return [];
    const sum = allNull
      ? item.total - item.constant
      : item.dice.reduce((s, d) => s + (d.kept ? (d.value ?? 0) : 0), 0);
    return [{ text: String(sum) }];
  }
  const out: LineSegment[] = [];
  let cursor = 0;
  let first = true;
  for (const t of parsed.value) {
    if (t.kind !== "dice") continue;
    const dice = item.dice.slice(cursor, cursor + t.count);
    cursor += t.count;
    if (first) {
      if (t.sign === -1) out.push({ text: "-" });
    } else {
      out.push({ text: t.sign === -1 ? " - " : " + " });
    }
    first = false;
    const group = t.sign === -1 && dice.length > 1;
    if (group) out.push({ text: "(" });
    dice.forEach((d, i) => {
      const prev = dice[i - 1];
      if (prev) out.push({ text: prev.kept && d.kept ? " + " : " " });
      out.push(d.kept ? { text: String(d.value) } : { text: String(d.value), style: "dropped" });
    });
    if (group) out.push({ text: ")" });
  }
  return out;
}

export function rollSegments(item: RollPayloadItem): LineSegment[] {
  const out: LineSegment[] = [{ text: item.label ?? item.expression }];
  if (item.mode === "advantage") out.push({ text: " (adv)" });
  if (item.mode === "disadvantage") out.push({ text: " (dis)" });
  out.push({ text: ": " });
  const dice = diceSegments(item);
  out.push(...dice);
  if (item.constant !== 0 || dice.length === 0) {
    const abs = Math.abs(item.constant);
    if (dice.length === 0) out.push({ text: String(item.constant) });
    else out.push({ text: item.constant < 0 ? ` - ${abs}` : ` + ${abs}` });
  }
  out.push({ text: " = " }, { text: String(item.total), style: "total" });
  if (item.natural === 20) out.push({ text: " — natural 20!" });
  if (item.natural === 1) out.push({ text: " — natural 1" });
  if (item.manual) out.push({ text: " " }, { text: "physical", style: "badge" });
  return out;
}

export const rollKind = defineLogKind({
  kind: ROLL_KIND,
  payload: RollEntryPayload,
  formatLine({ actorName, payload }) {
    const out: LineSegment[] = [{ text: actorName, style: "actor" }, { text: " — " }];
    payload.forEach((item, i) => {
      if (i > 0) out.push({ text: "; " });
      out.push(...rollSegments(item));
    });
    return out;
  },
});
