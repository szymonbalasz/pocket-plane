// Apply hooks (FR-MOD-38, -41, ADR-0043, protocol §26). APPEND-ONLY (AGENTS §9.9): a feature
// adds one import and one line to `applyHooks`; nothing else changes here.
//
// `cbt.applyCard` runs every hook's `beforeTarget`, in registry order, once per target, after the
// target's weapon raw is known and before `hpRules.apply`, inside its transaction. A hook returns
// extra raw damage (summed into the one `hpRules.apply`), player-safe line parts, the DM's line
// facts, rule-trigger parts for the hp_change row and the rows it changed (they join the target's
// `AttackApplied`). `cbt.undo` runs every hook's `revert` per undone hp_change row, before the
// card is reopened (`NotificationReopened`); its rows join that row's `CombatEntryUndone`. Hooks
// write through `env.tx` and never emit. A throw (e.g. `conflict`) rolls the command back. Hooks
// run on every apply: keep them to indexed reads.
import type {
  AttackLineDmPart,
  AttackLinePart,
  AttackLogDmPayload,
} from "@shared/combat-tracker/log-kinds";
import type {
  ApplyCardTarget,
  CombatantRecord,
  DamageCardPayload,
  HpChangeRecord,
  HpTriggerPart,
} from "@shared/combat-tracker/schemas";
import type { CommandEnv } from "../../commands/commands";
import type { RecordChange } from "../../events/types";

/** What a hook sees of one target of an apply. */
export interface ApplyTargetContext {
  card: DamageCardPayload;
  cardId: string;
  target: CombatantRecord;
  /** The DM's input for this target (hit, multiplier, `triggers`). */
  input: ApplyCardTarget;
  /** Allocated before the hooks run: the target's hp_change row id. */
  hpChangeId: string;
  /** The target's stored AC (FR-CBT-36) and the weapon damage after the row's multiplier. */
  targetAc: number;
  weaponRaw: number;
}

/** The DM's line facts a hook may set (`AttackLogDmPayload` fields; `parts` same index as the line's). */
export type ApplyHookDm = Partial<Pick<AttackLogDmPayload, "acMods" | "defense">> & {
  parts?: AttackLineDmPart[];
};

export interface ApplyTargetResult {
  /** Extra raw damage (≥ 0, integer; 0 on a miss): raw = weapon raw + Σ extra. */
  extraRaw: number;
  /** Player-safe line parts (`AttackLogPayload.parts`), inside `extraRaw`. */
  parts: AttackLinePart[];
  dm: ApplyHookDm;
  /** The hp_change row's `triggerParts` (DM). */
  triggerParts?: HpTriggerPart[];
  /** FR-MOD-24 (tier 2): the effective AC; the row's `targetAc` and the hit hint use it. */
  targetAc?: number;
  changes: RecordChange[];
}

export interface ApplyHook {
  /** `<feature>.<what>`, unique. */
  id: string;
  beforeTarget?(env: CommandEnv, a: ApplyTargetContext): ApplyTargetResult;
  revert?(env: CommandEnv, row: HpChangeRecord): RecordChange[];
}

/** The registry. Append your feature's line; order = run order = part order. */
export const applyHooks: readonly ApplyHook[] = [];

/** All hooks' results for one target, merged in registry order. */
export interface MergedApplyResult {
  extraRaw: number;
  parts: AttackLinePart[];
  dm: ApplyHookDm;
  triggerParts: HpTriggerPart[];
  targetAc: number;
  changes: RecordChange[];
}

/** Per-server hook list, seeded from the registry; tests may add hooks via `register`. */
export class ApplyHooks {
  private list: ApplyHook[] = [];

  constructor(initial: readonly ApplyHook[] = applyHooks) {
    for (const h of initial) this.register(h);
  }

  register(hook: ApplyHook): void {
    if (this.list.some((h) => h.id === hook.id)) {
      throw new Error(`Apply hook "${hook.id}" registered twice`);
    }
    this.list.push(hook);
  }

  /** Test support: remove a hook registered by a test. */
  unregister(id: string): void {
    this.list = this.list.filter((h) => h.id !== id);
  }

  /** `beforeTarget` of every hook in order; parts / DM parts / rows concatenated. */
  beforeTarget(env: CommandEnv, a: ApplyTargetContext): MergedApplyResult {
    const out: MergedApplyResult = {
      extraRaw: 0,
      parts: [],
      dm: {},
      triggerParts: [],
      targetAc: a.targetAc,
      changes: [],
    };
    for (const h of this.list) {
      const r = h.beforeTarget?.(env, a);
      if (!r) continue;
      if (!Number.isInteger(r.extraRaw) || r.extraRaw < 0) {
        throw new Error(`Apply hook "${h.id}": extraRaw must be an integer ≥ 0`);
      }
      if (!a.input.hit && r.extraRaw !== 0) {
        throw new Error(`Apply hook "${h.id}": extra damage on a miss`);
      }
      out.extraRaw += r.extraRaw;
      out.parts.push(...r.parts);
      const { parts: dmParts, ...dm } = r.dm;
      Object.assign(out.dm, dm);
      if (dmParts?.length) out.dm.parts = [...(out.dm.parts ?? []), ...dmParts];
      out.triggerParts.push(...(r.triggerParts ?? []));
      if (r.targetAc !== undefined) out.targetAc = r.targetAc;
      out.changes.push(...r.changes);
    }
    return out;
  }

  /** `revert` of every hook in order for one undone row; rows concatenated. */
  revert(env: CommandEnv, row: HpChangeRecord): RecordChange[] {
    return this.list.flatMap((h) => h.revert?.(env, row) ?? []);
  }
}

const bound = new WeakMap<object, ApplyHooks>();

export function bindApplyHooks(s: object, hooks: ApplyHooks): void {
  bound.set(s, hooks);
}

/** The apply hook list of a server instance (set at feature registration). */
export function applyHooksOf(s: object): ApplyHooks {
  const h = bound.get(s);
  if (!h) throw new Error("apply hooks are not bound on these services");
  return h;
}
