// `bun run start [--profile p]`: Hono serving dist/client, API and WS on one port.
if (!process.argv.includes("--client")) process.argv.push("--client");
await import("../src/server/index");

export {};
