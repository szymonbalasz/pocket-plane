// `bun run check`: typecheck + lint + bun test. Stops at the first failure.
const steps: [string, string[]][] = [
  ["typecheck", ["bun", "x", "tsc", "--noEmit"]],
  ["lint", ["bun", "x", "biome", "check", "."]],
  ["test", ["bun", "test"]],
];

for (const [name, cmd] of steps) {
  console.log(`\n== ${name}: ${cmd.join(" ")}`);
  const p = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit", stdin: "ignore" });
  const code = await p.exited;
  if (code !== 0) {
    console.error(`\n${name} failed (exit ${code}).`);
    process.exit(code);
  }
}
console.log("\ncheck: all green");

export {};
