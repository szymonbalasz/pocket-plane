// The import's one MCP session: the stdio MCP server spawned once (as `mcp:call` does), many
// tool calls. A tool error becomes a `ToolFailure` with the server's `{code, message, issues}`.
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface ToolIssue {
  path: (string | number)[];
  message: string;
}

export class ToolFailure extends Error {
  override name = "ToolFailure";
  constructor(
    readonly code: string,
    message: string,
    readonly issues: ToolIssue[] = [],
  ) {
    super(message);
  }
}

/** Codes after which no further call can succeed this run: stop, never retry a write. */
export const FATAL_CODES = new Set([
  "server_stopped",
  "server_not_running",
  "server_busy",
  "auth",
  "throttled",
  "mcp_closed",
  // Raised by the import itself: the active campaign isn't the one the run started with.
  "campaign_changed",
]);

export interface ToolCaller {
  /** The tool's JSON result; throws `ToolFailure` on a tool error. */
  call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

export interface StdioOptions {
  /** The checkout root (`src/mcp/index.ts` lives under it). */
  root: string;
  /** Target flags for the child (`--profile p` / `--play`). */
  args: string[];
  env: Record<string, string>;
  /** The child's cwd (it loads `.env` from here). Default `root`. */
  cwd?: string;
}

const textOf = (content: unknown) =>
  ((content ?? []) as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");

export async function connectStdio(opts: StdioOptions): Promise<ToolCaller> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(opts.root, "src/mcp/index.ts"), ...opts.args],
    env: opts.env,
    cwd: opts.cwd ?? opts.root,
    stderr: "inherit",
  });
  const client = new Client({ name: "gsb-import", version: "0.1.0" });
  try {
    await client.connect(transport);
  } catch {
    throw new ToolFailure("mcp_closed", "The MCP server did not start (see its message above)");
  }
  return {
    async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
      let res: Awaited<ReturnType<typeof client.callTool>>;
      try {
        res = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
      } catch (err) {
        throw new ToolFailure("mcp_closed", `MCP call ${name} failed: ${(err as Error).message}`);
      }
      const text = textOf(res.content);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      if (res.isError) {
        const e = (json ?? {}) as { code?: string; message?: string; issues?: ToolIssue[] };
        throw new ToolFailure(e.code ?? "internal", e.message ?? text, e.issues ?? []);
      }
      return json as T;
    },
    close: () => client.close(),
  };
}
