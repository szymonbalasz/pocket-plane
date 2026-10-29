// The MCP server (FR-AGENT-01/11/15): the §9 tools over any SDK transport. Results and errors
// are JSON text; errors are tool errors `{code, message, issues?}`; the secret is scrubbed.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Issue } from "@shared/protocol/codes";
import { z } from "zod";
import type { Caller, Log } from "./client";
import { AgentError, scrub, type ToolError, toToolError } from "./errors";
import { planCheckTool } from "./plan";
import { TOOLS, type ToolDef } from "./tools/registry";
// ---- tool modules (append-only: one import line per slice) ----
import "./tools/read";
import "./tools/creature";
import "./tools/homebrew";
import "./tools/character";

export const SERVER_NAME = "pocket-plane";
export const SERVER_VERSION = "0.1.0";

/** The registry plus `plan_check` over it. */
export const allTools = (tools: readonly ToolDef[] = TOOLS): ToolDef[] => [
  ...tools,
  planCheckTool(tools),
];

export function listing(t: ToolDef): Tool {
  const { $schema: _drop, ...schema } = z.toJSONSchema(t.input, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return {
    name: t.name,
    description: t.description,
    inputSchema: { ...schema, type: "object" },
    annotations: { readOnlyHint: !t.write, openWorldHint: false },
  };
}

export interface McpServerOptions {
  caller: Caller;
  log: Log;
  /** Scrubbed from every result and error (FR-AGENT-03). */
  dmSecret: string;
  /** Tests only; default = the registry. */
  tools?: readonly ToolDef[];
}

const issuesOf = (err: z.ZodError): Issue[] =>
  err.issues.map((i) => ({
    path: i.path.filter((p): p is string | number => typeof p !== "symbol"),
    message: i.message,
  }));

export function createMcpServer(opts: McpServerOptions): Server {
  const tools = allTools(opts.tools);
  const text = (v: unknown) => scrub(JSON.stringify(v, null, 2), opts.dmSecret);
  const fail = (e: ToolError): CallToolResult => ({
    isError: true,
    content: [{ type: "text", text: text(e) }],
  });

  // The low-level Server: McpServer would answer bad input with its own error text, not §11's.
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(listing) }));
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) return fail({ code: "invalid", message: `Unknown tool "${req.params.name}"` });
    const input = tool.input.safeParse(req.params.arguments ?? {});
    if (!input.success) {
      return fail({ code: "invalid", message: "Invalid input", issues: issuesOf(input.error) });
    }
    try {
      const result = await tool.run({ caller: opts.caller }, input.data);
      return { content: [{ type: "text", text: text(result) }] };
    } catch (err) {
      if (!(err instanceof AgentError)) {
        opts.log.error(
          scrub(`${tool.name} failed: ${err instanceof Error ? err.stack : err}`, opts.dmSecret),
        );
      }
      return fail(toToolError(err));
    }
  });
  return server;
}
