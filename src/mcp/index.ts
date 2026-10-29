// `bun run mcp [--profile p | --play]` (FR-AGENT-01/02, ADR-0072 D1; `--play` #382): the stdio
// MCP server. stdout carries MCP messages only; every log line goes to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, type parseConfig } from "@server/config";
import { mcpConfig, parseTargetArgs, UsageError } from "./args";
import { Caller, type Log } from "./client";
import { createMcpServer } from "./server";

// FR-AGENT-02: nothing but the transport may write to stdout, whatever a dependency logs.
console.log = console.error;
console.info = console.error;
console.debug = console.error;
console.warn = console.error;

const log: Log = {
  info: (m) => console.error(`[mcp] ${m}`),
  warn: (m) => console.error(`[mcp] warn: ${m}`),
  error: (m) => console.error(`[mcp] error: ${m}`),
};

let config: ReturnType<typeof parseConfig>;
let label: string;
try {
  const { target } = parseTargetArgs(process.argv.slice(2));
  // Secret required, slot not (FR-AGENT-01): the port comes from server.lock.
  ({ config, label } = mcpConfig(process.env, target));
} catch (err) {
  const usage = err instanceof UsageError;
  const msg = usage || err instanceof ConfigError ? (err as Error).message : String(err);
  console.error(`pocket-plane mcp: ${msg}`);
  if (usage) console.error("usage: bun run mcp [--profile dev|verify | --play]");
  process.exit(usage ? 2 : 1);
}

const caller = new Caller({
  dataDir: config.dataDir,
  profile: label,
  dmSecret: config.dmSecret,
  log,
});
const server = createMcpServer({ caller, log, dmSecret: config.dmSecret });
await server.connect(new StdioServerTransport());
// The session ended (Claude Code closed the pipe): nothing to clean up, no state kept.
process.stdin.on("end", () => process.exit(0));
log.info(`ready (${label === "play" ? "play" : `profile ${label}`}, data ${config.dataDir})`);
