// `bun run mcp:call <tool> '<json>' [--profile p | --play]` (AGENT §2, ADR-0072 D5; `--play`
// #382): spawns the stdio MCP server, calls one tool over real stdio, prints the result. Exit 1
// on a tool error, 2 on usage.
import path from "node:path";
import { type McpTarget, parseTargetArgs, targetArgs, UsageError } from "@mcp/args";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(import.meta.dir, "..");
const USAGE = "usage: bun run mcp:call <tool> '<json>' [--profile dev|verify | --play]";

let target: McpTarget;
let positional: string[];
try {
  ({ target, rest: positional } = parseTargetArgs(process.argv.slice(2)));
} catch (err) {
  console.error(`mcp:call: ${err instanceof UsageError ? err.message : String(err)}`);
  console.error(USAGE);
  process.exit(2);
}
const [tool, json = "{}"] = positional;
if (!tool) {
  console.error(USAGE);
  process.exit(2);
}
let args: Record<string, unknown>;
try {
  args = JSON.parse(json);
  if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error();
} catch {
  console.error(`mcp:call: the input must be a JSON object\n${USAGE}`);
  process.exit(2);
}

// Explicit env (CI has no .env); the child also loads <worktree>/.env from its cwd.
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, "src/mcp/index.ts"), ...targetArgs(target)],
  env,
  cwd: ROOT,
  stderr: "inherit",
});
const client = new Client({ name: "mcp-call", version: "0.1.0" });
try {
  await client.connect(transport);
} catch {
  console.error("mcp:call: the MCP server did not start (see its message above)");
  process.exit(1);
}
const res = await client.callTool({ name: tool, arguments: args });
const content = (res.content ?? []) as { type: string; text?: string }[];
const text = content
  .filter((c) => c.type === "text")
  .map((c) => c.text ?? "")
  .join("\n");
(res.isError ? console.error : console.log)(text);
await client.close();
process.exit(res.isError ? 1 : 0);
