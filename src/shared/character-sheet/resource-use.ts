// Feature use with a cost (class-resources FR-CRES-09–12), pure: plan a Use from the row's spend
// link, describe a Flexible Casting step, apply a line's counter changes (and give them back for
// Undo). The server writes what these return; the sheet's Use button reads `spendText` / `planUse`
// to label and enable itself.
import type { SpellLevelKey } from "@shared/entities/schemas";
import { featureUsedCap, pactMax, slotMax } from "./counters";
import type { ResourceOp, ResourceUsePayload } from "./resource-use-kind";
import type { FeatureRow, SheetData, SpendLink } from "./sheet";
import { pointsLeft, sorceryRow, tickSlots } from "./sorcery";

type Stats = Parameters<typeof slotMax>[0];
export type Counters = Pick<SheetData, "slotsUsed" | "slotsCreated" | "pactUsed" | "features">;

const ordinal = (n: number | string) => {
  const v = Number(n);
  return `${v}${v === 1 ? "st" : v === 2 ? "nd" : v === 3 ? "rd" : "th"}`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The name a spend source is counted in: "sorcery points", "Channel Divinity", "pact slot". */
function sourceWords(sheet: Pick<SheetData, "features">, link: SpendLink, n: number): string {
  const from = link.from;
  if ("pact" in from) return plural(n, "pact slot", "pact slots");
  if ("slot" in from) return plural(n, "spell slot", "spell slots");
  const row = sheet.features.find((f) => f.id === from.feature);
  if (!row) return `${n} of a missing feature`;
  if (row.pool === "sorcery-points") return plural(n, "sorcery point", "sorcery points");
  return `${n} ${row.name}`;
}

/** FR-CRES-10: the row's cost as shown beside Use ("2 sorcery points", "a pact slot"). */
export function spendText(sheet: Pick<SheetData, "features">, link: SpendLink): string {
  if (link.amount === "ask") {
    const from = link.from;
    if ("pact" in from) return "pact slots";
    if ("slot" in from) return "spell slots";
    const row = sheet.features.find((f) => f.id === from.feature);
    return row?.pool === "sorcery-points" ? "sorcery points" : (row?.name ?? "a missing feature");
  }
  if ("pact" in link.from && link.amount === 1) return "a pact slot";
  if ("slot" in link.from && link.amount === 1) return "a spell slot";
  return sourceWords(sheet, link, link.amount);
}

/** FR-CRES-09: the link's source row is gone ("Spend source missing", Use disabled). */
export const spendMissing = (sheet: Pick<SheetData, "features">, link: SpendLink): boolean =>
  "feature" in link.from &&
  !sheet.features.some((f) => f.id === (link.from as { feature: string }).feature);

export type UsePlan =
  | { ok: true; ops: ResourceOp[]; payload: Omit<ResourceUsePayload, "characterId"> }
  | { ok: false; code: "invalid" | "conflict"; message: string; overspend?: true };

export interface UseInput {
  amount?: number;
  slotLevel?: number;
  overspend?: boolean;
}

/** A feature row spend of `n` uses, with the overspend floor (FR-CHARX-58, MOD FR-MOD-59). */
function spendRow(f: FeatureRow, n: number, overspend: boolean): UsePlan | ResourceOp {
  const left = pointsLeft(f);
  if (f.used + n > featureUsedCap(f)) {
    return { ok: false, code: "conflict", message: `${f.name}: can't go below −9` };
  }
  if (left < n && !overspend) {
    return {
      ok: false,
      code: "conflict",
      message: `Not enough ${f.pool === "sorcery-points" ? "sorcery points" : f.name} (${left} left)`,
      overspend: true,
    };
  }
  return { on: "feature", id: f.id, n };
}

const isOp = (x: UsePlan | ResourceOp): x is ResourceOp => "on" in x;

/**
 * FR-CRES-11: what a Use of `rowId` spends. The link's source (a row's uses, pact slots, or a
 * slot of `slotLevel`, created ones first), then 1 of the row's own uses when it has some.
 */
export function planUse(sheet: Counters, stats: Stats, rowId: string, input: UseInput): UsePlan {
  const row = sheet.features.find((f) => f.id === rowId);
  if (!row) return { ok: false, code: "invalid", message: "Feature was deleted" };
  const link = row.spend;
  if (!link) return { ok: false, code: "invalid", message: `${row.name} has no cost to spend` };
  if (link.amount === "ask" && input.amount === undefined) {
    return { ok: false, code: "invalid", message: "Enter an amount" };
  }
  if (link.amount !== "ask" && input.amount !== undefined && input.amount !== link.amount) {
    return { ok: false, code: "invalid", message: `${row.name} costs ${link.amount}` };
  }
  const n = link.amount === "ask" ? (input.amount ?? 0) : link.amount;
  const overspend = input.overspend === true;
  const ops: ResourceOp[] = [];
  let left: string | undefined;
  const from = link.from;
  if ("feature" in from) {
    const src = sheet.features.find((f) => f.id === from.feature);
    if (!src?.usesMax) return { ok: false, code: "invalid", message: "Spend source missing" };
    const op = spendRow(src, n, overspend);
    if (!isOp(op)) return op;
    ops.push(op);
    left = `${pointsLeft(src) - n} left`;
  } else if ("pact" in from) {
    if (pactMax(stats) === 0) return { ok: false, code: "invalid", message: "No pact slots" };
    const free = pactMax(stats) - sheet.pactUsed;
    if (free < n) return { ok: false, code: "conflict", message: `No pact slot left (${free})` };
    ops.push({ on: "pact", n });
    left = `${plural(free - n, "pact slot", "pact slots")} left`;
  } else {
    if (input.slotLevel === undefined) {
      return { ok: false, code: "invalid", message: "Pick a slot level" };
    }
    const level = String(input.slotLevel) as SpellLevelKey;
    const t = tickSlots(sheet, stats, level, n);
    if (t.changed < n) {
      return {
        ok: false,
        code: "conflict",
        message: `Not enough ${ordinal(level)}-level slots`,
      };
    }
    const fromCreated =
      (sheet.slotsCreated[level as keyof typeof sheet.slotsCreated] ?? 0) -
      (t.slotsCreated[level as keyof typeof t.slotsCreated] ?? 0);
    if (fromCreated > 0) ops.push({ on: "created", level, n: -fromCreated });
    if (n - fromCreated > 0) ops.push({ on: "slot", level, n: n - fromCreated });
  }
  if (row.usesMax) {
    const own = spendRow(row, 1, overspend);
    if (!isOp(own)) return own;
    ops.push(own);
  }
  const what =
    "slot" in from && input.slotLevel !== undefined
      ? `${plural(n, `${ordinal(input.slotLevel)}-level slot`, `${ordinal(input.slotLevel)}-level slots`)}`
      : sourceWords(sheet, link, n);
  return {
    ok: true,
    ops,
    payload: { action: "use", name: row.name, detail: `−${what}`, ...(left ? { left } : {}), ops },
  };
}

/** Applies `ops` (`sign` −1 = Undo). Counters stay in bounds (Undo after other changes clamps). */
export function applyOps(
  sheet: Counters,
  stats: Stats,
  ops: readonly ResourceOp[],
  sign: 1 | -1,
): Counters {
  let out: Counters = { ...sheet };
  for (const op of ops) {
    const n = op.n * sign;
    if (op.on === "feature") {
      out = {
        ...out,
        features: out.features.map((f) =>
          f.id === op.id ? { ...f, used: Math.max(0, Math.min(featureUsedCap(f), f.used + n)) } : f,
        ),
      };
    } else if (op.on === "pact") {
      out = { ...out, pactUsed: Math.max(0, Math.min(pactMax(stats), out.pactUsed + n)) };
    } else if (op.on === "slot") {
      const l = op.level as SpellLevelKey;
      const v = Math.max(0, Math.min(slotMax(stats, l), (out.slotsUsed[l] ?? 0) + n));
      const slotsUsed = { ...out.slotsUsed };
      if (v > 0) slotsUsed[l] = v;
      else delete slotsUsed[l];
      out = { ...out, slotsUsed };
    } else {
      const l = op.level as keyof Counters["slotsCreated"];
      const v = Math.max(0, Math.min(9, (out.slotsCreated[l] ?? 0) + n));
      const slotsCreated = { ...out.slotsCreated };
      if (v > 0) slotsCreated[l] = v;
      else delete slotsCreated[l];
      out = { ...out, slotsCreated };
    }
  }
  return out;
}

/**
 * Undo of a created slot that has since been spent can't give the points back fairly:
 * `conflict` (FR-CRES-12). Other ops always undo (clamped).
 */
export function undoBlock(sheet: Counters, ops: readonly ResourceOp[]): string | null {
  for (const op of ops) {
    if (op.on === "created" && op.n > 0) {
      const l = op.level as keyof Counters["slotsCreated"];
      if ((sheet.slotsCreated[l] ?? 0) < op.n) return "That created slot was already spent";
    }
  }
  return null;
}

/** The counter changes between two states (Flexible Casting writes its line from them). */
export function opsBetween(a: Counters, b: Counters): ResourceOp[] {
  const ops: ResourceOp[] = [];
  for (const f of b.features) {
    const before = a.features.find((x) => x.id === f.id)?.used ?? 0;
    if (f.used !== before) ops.push({ on: "feature", id: f.id, n: f.used - before });
  }
  const levels = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
  for (const l of levels) {
    const su = (b.slotsUsed[l] ?? 0) - (a.slotsUsed[l] ?? 0);
    if (su !== 0) ops.push({ on: "slot", level: l, n: su });
    const k = l as keyof Counters["slotsCreated"];
    const sc = (b.slotsCreated[k] ?? 0) - (a.slotsCreated[k] ?? 0);
    if (sc !== 0) ops.push({ on: "created", level: l, n: sc });
  }
  if (b.pactUsed !== a.pactUsed) ops.push({ on: "pact", n: b.pactUsed - a.pactUsed });
  return ops;
}

/** FR-CRES-12: the convert / create line's words. */
export function flexPayload(
  action: "convert" | "create",
  sheet: Counters,
  what: { from?: { slot: number } | { pact: true }; level?: number },
  points: { before: number; after: number },
  ops: ResourceOp[],
): Omit<ResourceUsePayload, "characterId"> {
  const pool = sorceryRow(sheet);
  const max = pool?.usesMax ?? 0;
  const left = `${points.after} / ${max} sorcery points`;
  if (action === "convert") {
    const from = what.from;
    const name =
      from && "pact" in from
        ? "Pact slot → sorcery points"
        : `${ordinal(from && "slot" in from ? from.slot : 0)}-level slot → sorcery points`;
    const gained = points.after - points.before;
    return {
      action,
      name,
      detail: `+${plural(gained, "sorcery point", "sorcery points")}`,
      left,
      ops,
    };
  }
  const cost = points.before - points.after;
  return {
    action,
    name: `Sorcery points → ${ordinal(what.level ?? 0)}-level slot`,
    detail: `−${plural(cost, "sorcery point", "sorcery points")}`,
    left,
    ops,
  };
}
