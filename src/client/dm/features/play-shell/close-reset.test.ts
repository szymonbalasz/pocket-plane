// FR-SHELL-200: the DM-only window types' `onClose` (the shared ones:
// `@ui/features/play-shell/close-reset.test.ts`), as registered.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { ENCOUNTERS_KIND } from "@ui/features/combat-tracker/window";
import { dmWindows } from "../../windows";
import { openEncounterKey } from "../combat-tracker/open-encounter";
import { STATBLOCK_KIND } from "../entities/statblock/logic";
import { useStatBlockTarget } from "../entities/statblock/store";

const you = { campaignId: "c1", role: "dm", playerId: null } as You;
const onClose = (kind: string) => dmWindows.get(kind)?.onClose?.(you);

describe("FR-SHELL-200 close resets what the DM window shows", () => {
  const g = globalThis as { window?: unknown };
  const was = g.window;
  const data = new Map<string, string>();
  beforeEach(() => {
    data.clear();
    const localStorage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    g.window = { localStorage };
  });
  afterEach(() => {
    if (was === undefined) delete g.window;
    else g.window = was;
  });

  test("FR-SHELL-200 Stat block: no creature", () => {
    useStatBlockTarget.getState().show({ definitionId: "d1" } as never);
    onClose(STATBLOCK_KIND);
    expect(useStatBlockTarget.getState().target).toBeNull();
  });

  test("FR-SHELL-200 Encounters: back to the list after a reopen or reload", () => {
    data.set(openEncounterKey("c1"), "enc-1");
    onClose(ENCOUNTERS_KIND);
    expect(data.has(openEncounterKey("c1"))).toBe(false);
  });
});
