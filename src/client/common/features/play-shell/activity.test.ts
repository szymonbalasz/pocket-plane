import { describe, expect, mock, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { emptyStore } from "@shared/protocol/store";
import {
  type ActivityBaselines,
  type ActivityValue,
  activityDots,
  NO_BASELINES,
  nextBaselines,
  readActivity,
} from "./activity";
import type { Windows } from "./manager";

const win = (kind: string, state: WindowState["state"]): WindowState => ({
  kind,
  instance: "main",
  state,
  x: 0,
  y: 60,
  w: 300,
  h: 200,
  z: 1,
});

/** A page: the layout as rendered plus the current `activity` value per kind. */
function page(key = "k1") {
  const value = new Map<string, ActivityValue>([
    ["dice.log", 3],
    ["a.other", "x"],
  ]);
  let baselines: ActivityBaselines = NO_BASELINES;
  const read = (kind: string) => value.get(kind) ?? null;
  return {
    value,
    /** One render of the launcher with `windows`: baselines move, dots are read. */
    render(windows: Windows, k = key) {
      baselines = nextBaselines(baselines, k, windows, read);
      return [...activityDots(baselines, windows, read)];
    },
  };
}

describe("FR-SHELL-38 activity dot", () => {
  test("FR-SHELL-38 value captured at minimise; a change lights the dot; restore clears it", () => {
    const p = page();
    expect(p.render([win("dice.log", "open")])).toEqual([]);
    p.value.set("dice.log", 4); // while open: nothing to show
    expect(p.render([win("dice.log", "open")])).toEqual([]);
    const parked = [win("dice.log", "minimised")];
    expect(p.render(parked)).toEqual([]); // baseline 4
    p.value.set("dice.log", 5);
    expect(p.render(parked)).toEqual(["dice.log"]);
    expect(p.render([win("dice.log", "open")])).toEqual([]); // restore clears
    expect(p.render(parked)).toEqual([]); // minimised again: new baseline 5
    p.value.set("dice.log", 6);
    expect(p.render(parked)).toEqual(["dice.log"]);
  });

  test("FR-SHELL-38 close clears it; a closed window never shows it", () => {
    const p = page();
    p.render([win("dice.log", "minimised")]);
    p.value.set("dice.log", 9);
    expect(p.render([win("dice.log", "minimised")])).toEqual(["dice.log"]);
    expect(p.render([win("dice.log", "closed")])).toEqual([]);
    p.value.set("dice.log", 10);
    expect(p.render([win("dice.log", "closed")])).toEqual([]);
  });

  test("FR-SHELL-38 back to the baseline value → no dot (a difference, not a count)", () => {
    const p = page();
    p.render([win("dice.log", "minimised")]);
    p.value.set("dice.log", 4);
    expect(p.render([win("dice.log", "minimised")])).toEqual(["dice.log"]);
    p.value.set("dice.log", 3);
    expect(p.render([win("dice.log", "minimised")])).toEqual([]);
  });

  test("FR-SHELL-38 restored minimised after load: baseline from the first snapshot, no dot", () => {
    const p = page();
    // The layout (and its key) only exist once the first snapshot is in the store.
    expect(p.render([], "k1")).toEqual([]);
    expect(p.render([win("dice.log", "minimised"), win("a.other", "minimised")])).toEqual([]);
    p.value.set("a.other", "y"); // a later change (e.g. a reconnect snapshot) is news
    expect(p.render([win("dice.log", "minimised"), win("a.other", "minimised")])).toEqual([
      "a.other",
    ]);
  });

  test("FR-SHELL-38 a new layout key (campaign switch) takes fresh baselines", () => {
    const p = page();
    p.render([win("dice.log", "minimised")], "k1");
    p.value.set("dice.log", 7);
    expect(p.render([win("dice.log", "minimised")], "k1")).toEqual(["dice.log"]);
    expect(p.render([win("dice.log", "minimised")], "k2")).toEqual([]);
  });

  test("FR-SHELL-38 baselines are per window and unchanged renders keep the same object", () => {
    const read = () => 1;
    const ws = [win("dice.log", "minimised")];
    const a = nextBaselines(NO_BASELINES, "k1", ws, read);
    expect(nextBaselines(a, "k1", ws, read)).toBe(a);
    expect(nextBaselines(a, "k1", [win("dice.log", "open")], read).values.size).toBe(0);
  });

  test("FR-SHELL-38 no `activity` → null, never a dot", () => {
    expect(readActivity({ kind: "a.none" }, emptyStore())).toBeNull();
  });

  test("FR-SHELL-38 a throwing `activity` → null, no dot, one warning", () => {
    const warn = mock(() => {});
    const def = {
      kind: "a.throws",
      activity: () => {
        throw new Error("boom");
      },
    };
    expect(readActivity(def, emptyStore(), warn)).toBeNull();
    expect(readActivity(def, emptyStore(), warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const read = (kind: string) => readActivity({ ...def, kind }, emptyStore(), warn);
    const ws = [win("a.throws", "minimised")];
    const b = nextBaselines(NO_BASELINES, "k1", ws, read);
    expect([...activityDots(b, ws, read)]).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
