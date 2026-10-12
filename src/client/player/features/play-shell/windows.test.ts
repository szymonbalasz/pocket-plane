import { expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { defaultLayout } from "@ui/features/play-shell/manager";
import { availableKinds } from "@ui/features/play-shell/registry";
import { playerWindows } from "../../windows";

test("FR-SHELL-07 player registry loads; every type is a player window", () => {
  expect(playerWindows.client).toBe("player");
  for (const d of playerWindows.defs) expect(d.clients).toContain("player");
  expect(playerWindows.get("camp.players")).toBeUndefined();
});

test("FR-SHELL-20 test mode off → shell.test, sync.probes absent; on → present", () => {
  expect([...availableKinds(playerWindows, emptyStore())]).toEqual([]);
  const on = availableKinds(playerWindows, { ...emptyStore(), records: { probe: {} } });
  expect([...on].sort()).toEqual(["shell.test", "sync.probes"]);
});

test("FR-SHELL-14 player default layout: no window open in the Scenes phase", () => {
  expect(defaultLayout(playerWindows, { w: 1600, h: 900 })).toEqual([]);
});
