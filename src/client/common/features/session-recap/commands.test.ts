// FR-RECAP-28: the palette's "Session recap" command (both clients): found by "recap" / "summary" /
// "session", runs as a click would (opens `recap.session` on the newest session, by the user).
import { expect, test } from "bun:test";
import { RECAP_WINDOW_KIND } from "@shared/session-recap/schemas";
import { COMMANDS, PROVIDERS } from "../play-shell/commands";
import { localEntries, rankLocal } from "../play-shell/palette/rank";
import { testCtx } from "../play-shell/palette/test-env";
import { viewKey } from "../stats/view";
import { recapViews } from "./open";

test("FR-RECAP-28 palette: 'Session recap' found by its keywords on both clients; runs an open of recap.session on the newest session", async () => {
  for (const client of ["dm", "player"] as const) {
    const ctx = testCtx({ client, registryExtra: [RECAP_WINDOW_KIND] });
    const entries = localEntries(COMMANDS, PROVIDERS, ctx);
    for (const q of ["recap", "summary", "session recap"]) {
      const commands = rankLocal(entries, q).find((s) => s.group === "Commands");
      expect(commands?.rows.map((r) => r.key)).toContain("c:recap.open");
    }
    const you = ctx.store.you;
    if (!you) throw new Error("no viewer");
    recapViews().set(viewKey(you), { fromN: 7 });
    await COMMANDS.find((c) => c.id === "recap.open")?.run(ctx);
    expect(ctx.calls).toEqual([`open:${RECAP_WINDOW_KIND}`]);
    expect(recapViews().get(viewKey(you))).toEqual({ fromN: null });
    expect(ctx.windows.find((w) => w.kind === RECAP_WINDOW_KIND)?.state).toBe("open");
  }
});
