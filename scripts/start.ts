// `bun run start [--profile p]`: Hono serving dist/client, API and WS on one port.
// The server runs as a detached child so a console Ctrl+C always ends in a clean stop
// (see scripts/lib/server-process.ts).
import { spawnServer } from "./lib/server-process";

const server = spawnServer(["--client", ...process.argv.slice(2)]);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void server.stop().then((code) => process.exit(code));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("SIGBREAK", stop);

process.exit(await server.proc.exited);
