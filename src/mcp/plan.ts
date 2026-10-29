// `plan_check` (FR-AGENT-19): a whole plan checked against one fresh read; writes nothing.
// Generic checks here (known tool, its zod input); per-tool checks are each tool's `plan`.
import {
  CREATURE_SHEET_TYPE,
  CreatureSheetRecord,
  ROW_LIMITS,
} from "@shared/character-sheet/sheet";
import {
  ENTITY_TYPE,
  type EntityKind,
  EntityRecord,
  entityNameKey,
  IMPORTED_ENTITY_TYPE,
  ImportedEntityRecord,
} from "@shared/entities/schemas";
import type { SheetRowList } from "@shared/events/character-sheet";
import type { Issue } from "@shared/protocol/codes";
import { z } from "zod";
import type { Caller, WsSession } from "./client";
import { defineTool, type ToolDef } from "./tools/registry";

export const PLAN_CALLS_MAX = 100;
export const PLAN_CHECK = "plan_check";

export const PlanCheckInput = z.strictObject({
  calls: z
    .array(z.strictObject({ tool: z.string().min(1).max(64), input: z.unknown().optional() }))
    .min(1)
    .max(PLAN_CALLS_MAX),
});
export type PlanCheckInput = z.infer<typeof PlanCheckInput>;

export interface PlanIssue {
  /** Index into `calls`. */
  call: number;
  path: Issue["path"];
  message: string;
}
export interface PlanResult {
  ok: boolean;
  issues: PlanIssue[];
  would: string[];
}

/** The one fresh read a plan is checked against. */
export interface PlanWorld {
  campaign: { id: string; name: string };
  entities: EntityRecord[];
  sheets: CreatureSheetRecord[];
  /** An imported definition by id (`sync.load`, cached); null = none. */
  imported(id: string): Promise<ImportedEntityRecord | null>;
}

export interface PlanContext {
  /** Index of the call being checked. */
  readonly call: number;
  readonly world: PlanWorld;
  /** For a checker's extra read-only lookups (e.g. a compendium entry). */
  readonly caller: Caller;
  /** `path` is relative to the call's `input`. */
  issue(path: Issue["path"], message: string): void;
  /** The target exists, is `kind` and isn't imported; null (with an issue) otherwise. */
  target(id: string, path: Issue["path"], kind: EntityKind): Promise<EntityRecord | null>;
  /** FR-ENT-08: unique case-insensitive among the campaign's entities of `kind`, and the plan's. */
  claimEntityName(kind: EntityKind, name: string, path: Issue["path"]): void;
  /** The same rule for any other name scope (e.g. homebrew per kind, FR-CMP-24). */
  claimName(scope: string, name: string, path: Issue["path"], existing: Iterable<string>): void;
  /** `ROW_LIMITS` incl. rows planned earlier for the same creature (or planned creature key). */
  planRows(creatureId: string, list: SheetRowList, add: number, path: Issue["path"]): void;
}

/** Runs the generic checks, then each tool's checker, in plan order. Pure but for `world`. */
export async function checkPlan(
  calls: PlanCheckInput["calls"],
  tools: readonly ToolDef[],
  world: PlanWorld,
  caller: Caller,
): Promise<PlanResult> {
  const issues: PlanIssue[] = [];
  const would: string[] = [];
  const claimed = new Map<string, Map<string, number>>();
  const plannedRows = new Map<string, number>();

  for (const [i, call] of calls.entries()) {
    const add = (path: Issue["path"], message: string) => issues.push({ call: i, path, message });
    const tool = tools.find((t) => t.name === call.tool);
    if (!tool || tool.name === PLAN_CHECK) {
      add(["tool"], `Unknown tool "${call.tool}"`);
      continue;
    }
    const parsed = tool.input.safeParse(call.input ?? {});
    if (!parsed.success) {
      for (const iss of parsed.error.issues) {
        add(["input", ...(iss.path as Issue["path"])], iss.message);
      }
      continue;
    }
    const claimName: PlanContext["claimName"] = (scope, name, path, existing) => {
      const key = entityNameKey(name.trim());
      const planned = claimed.get(scope) ?? new Map<string, number>();
      claimed.set(scope, planned);
      const earlier = planned.get(key);
      if (earlier !== undefined) {
        add(["input", ...path], `Name "${name}" is already used by call ${earlier}`);
      } else if ([...existing].some((n) => entityNameKey(n) === key)) {
        add(["input", ...path], `Name "${name}" is taken`);
      }
      if (earlier === undefined) planned.set(key, i);
    };
    const ctx: PlanContext = {
      call: i,
      world,
      caller,
      issue: (path, message) => add(["input", ...path], message),
      async target(id, path, kind) {
        const e = world.entities.find((x) => x.id === id);
        if (e) {
          if (e.kind !== kind) add(["input", ...path], `Not a ${kind}: ${e.name}`);
          return e.kind === kind ? e : null;
        }
        const imp = await world.imported(id);
        add(
          ["input", ...path],
          imp
            ? `${imp.name} is imported and read-only: derive a custom creature`
            : `No ${kind} ${id}`,
        );
        return null;
      },
      claimEntityName: (kind, name, path) =>
        claimName(
          `entity:${kind}`,
          name,
          path,
          world.entities.filter((e) => e.kind === kind).map((e) => e.name),
        ),
      claimName,
      planRows(creatureId, list, n, path) {
        const key = `${creatureId}:${list}`;
        const e = world.entities.find((x) => x.id === creatureId);
        const sheet = world.sheets.find((s) => s.id === creatureId);
        const has =
          list === "attacks" ? (e?.statBlock.attacks.length ?? 0) : (sheet?.[list].length ?? 0);
        const before = plannedRows.get(key) ?? 0;
        plannedRows.set(key, before + n);
        if (has + before + n > ROW_LIMITS[list]) {
          add(
            ["input", ...path],
            `Too many ${list}: ${ROW_LIMITS[list]} max (has ${has}, the plan adds ${before + n})`,
          );
        }
      },
    };
    would.push(tool.plan ? await tool.plan(ctx, parsed.data) : `${tool.name}: read only`);
  }
  return { ok: issues.length === 0, issues, would };
}

/** The world from one WS session: the DM snapshot, imported definitions loaded on demand. */
export function worldOf(s: WsSession): PlanWorld {
  const cache = new Map<string, ImportedEntityRecord | null>();
  return {
    campaign: s.campaign,
    entities: s.records(ENTITY_TYPE, EntityRecord),
    sheets: s.records(CREATURE_SHEET_TYPE, CreatureSheetRecord),
    async imported(id) {
      if (!cache.has(id)) {
        const ok = id.length > 0 && id.length <= 64;
        const rows = ok ? await s.load(IMPORTED_ENTITY_TYPE, ImportedEntityRecord, [id]) : [];
        cache.set(id, rows.find((r) => r.id === id) ?? null);
      }
      return cache.get(id) ?? null;
    },
  };
}

/** The `plan_check` tool over `tools` (the registry, plus itself excluded). */
export function planCheckTool(tools: readonly ToolDef[]): ToolDef {
  return defineTool({
    name: PLAN_CHECK,
    description:
      "Check a whole plan of tool calls against one fresh read of the campaign, without writing anything. " +
      "Returns {ok, issues: [{call, path, message}], would: [summary per call]}. Run it before any write.",
    input: PlanCheckInput,
    write: false,
    run: ({ caller }, input) =>
      caller.ws({}, (s) => checkPlan(input.calls, tools, worldOf(s), caller)),
  });
}
