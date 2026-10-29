// `bun run mcp [--profile p]` (FR-AGENT-01/02, ADR-0072 D1): the stdio MCP server. stdout
// carries MCP messages only; every log line goes to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, parseConfig } from "@server/config";
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

function profileArg(argv: readonly string[]): string | undefined {
  const i = argv.indexOf("--profile");
  return i === -1 ? undefined : argv[i + 1];
}

let config: ReturnType<typeof parseConfig>;
try {
  // Secret required, slot not (FR-AGENT-01): the port comes from server.lock.
  config = parseConfig(process.env, { profile: profileArg(process.argv), requireSecret: true });
} catch (err) {
  console.error(`pocket-plane mcp: ${err instanceof ConfigError ? err.message : String(err)}`);
  process.exit(1);
}

const caller = new Caller({
  dataDir: config.dataDir,
  profile: config.profile,
  dmSecret: config.dmSecret,
  log,
});
const server = createMcpServer({ caller, log, dmSecret: config.dmSecret });
await server.connect(new StdioServerTransport());
// The session ended (Claude Code closed the pipe): nothing to clean up, no state kept.
process.stdin.on("end", () => process.exit(0));
log.info(`ready (profile ${config.profile}, data ${config.dataDir})`);
