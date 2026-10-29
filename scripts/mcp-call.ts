// `bun run mcp:call <tool> '<json>' [--profile p]` (AGENT §2, ADR-0072 D5): spawns the stdio MCP
// server, calls one tool over real stdio, prints the result. Exit 1 on a tool error, 2 on usage.
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(import.meta.dir, "..");
const USAGE = "usage: bun run mcp:call <tool> '<json>' [--profile dev|verify]";

const argv = process.argv.slice(2);
const pi = argv.indexOf("--profile");
const profile = pi === -1 ? undefined : argv[pi + 1];
const positional = argv.filter((_, i) => pi === -1 || (i !== pi && i !== pi + 1));
const [tool, json = "{}"] = positional;
if (!tool || (pi !== -1 && !profile)) {
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
  args: [path.join(ROOT, "src/mcp/index.ts"), ...(profile ? ["--profile", profile] : [])],
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
