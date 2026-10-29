// Tool registry (AGENT §9). Append-only: each tools module registers its tools on import, and
// `src/mcp/server.ts` imports each module with one line.
import type { z } from "zod";
import type { Caller } from "../client";
import type { PlanContext } from "../plan";

export interface ToolContext {
  caller: Caller;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  /** The route / intent's `@shared` zod body (or the tool's own wrapper of it). */
  input: S;
  /** FR-AGENT-15: false → `readOnlyHint: true`; true → Claude Code asks before each call. */
  write: boolean;
  run(ctx: ToolContext, input: z.output<S>): Promise<unknown>;
  /**
   * `plan_check`'s per-tool checker (FR-AGENT-19), run after the generic checks pass: report
   * issues on `ctx`, return the `would` line. Absent → "‹tool›: read only".
   */
  plan?(ctx: PlanContext, input: z.output<S>): Promise<string> | string;
}

/** Erases the input type so differently-typed tools share one list (each `run` gets parsed input). */
export const defineTool = <S extends z.ZodType>(t: ToolDef<S>): ToolDef => t as unknown as ToolDef;

export const TOOLS: ToolDef[] = [];

export function registerTools(...tools: ToolDef[]) {
  for (const t of tools) {
    if (TOOLS.some((x) => x.name === t.name)) throw new Error(`Tool ${t.name} registered twice`);
    TOOLS.push(t);
  }
}
