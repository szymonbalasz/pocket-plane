// Seams S3 / FR-SHELL-186 (PM2): the palette's "Party status" command, both clients: listed in
// `COMMANDS`, opens Party Manager through the palette's shell (`by: "user"`) with Party status as
// the stored tab, as `openPartyTab("status")`.
import { afterEach, expect, test } from "bun:test";
import { COMMANDS } from "../play-shell/commands";
import { testCtx } from "../play-shell/palette/test-env";
import { PM2_COMMANDS } from "./commands";
import { PARTY_BOARD_KIND } from "./logic";
import { tabKeyOf } from "./open-tab";
import { partyMemory } from "./seen";

afterEach(() => partyMemory().tabs.bind(null));

test('FR-SHELL-186 Party status command (seams S3): both clients; runs openPartyTab("status"): Party Manager opened through the shell, Party status stored', () => {
  expect(PM2_COMMANDS.every((c) => COMMANDS.includes(c))).toBe(true);
  const cmd = COMMANDS.find((c) => c.id === "party.status");
  expect(cmd).toMatchObject({
    title: "Party status",
    group: "Commands",
    clients: ["dm", "player"],
  });
  for (const client of ["dm", "player"] as const) {
    const ctx = testCtx({ client });
    partyMemory().tabs.choose(tabKeyOf(ctx.store.you), "loot");
    cmd?.run(ctx);
    expect(ctx.calls).toEqual([`open:${PARTY_BOARD_KIND}`]);
    expect(partyMemory().tabs.state.getState()).toEqual({
      key: tabKeyOf(ctx.store.you),
      tab: "status",
    });
  }
});
