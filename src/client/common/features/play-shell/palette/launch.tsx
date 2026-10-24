// SP1's commands (FR-SHELL-186, -189): the palette chord, the sheet, Roll dice, the window keys and
// the launch commands. Each does only what a click in the UI does (ADR-0067 §1): a `by: "user"`
// window open, FR-SHELL-153's reset, or an intent the UI already sends (`cbt.nextTurn`,
// `cbt.prevTurn`, `camp.resume`), checked by the server as today.
import { RESUME_INTENT } from "@shared/campaign-management/table-state";
import { notRestoredText } from "@shared/combat-extras/rules";
import {
  COMBATANT_TYPE,
  type CombatantView,
  type TurnResult,
} from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { type RecordStore, recordsOf } from "@shared/protocol/store";
import { toast } from "sonner";
import { openSheetFor } from "../../character-sheet/selection";
import { CHAR_SHEET_KIND } from "../../character-sheet/window";
import { skipText, stepSkip } from "../../combat-extras/skip";
import { startedIn } from "../../combat-tracker/store";
import { INITIATIVE_KIND } from "../../combat-tracker/window";
import { CMP_KIND } from "../../compendium/logic";
import { DICEX_TRAY_KIND } from "../../dice-extras/window-kind";
import { DICE_LOG_KIND } from "../../dice-roll-log/window";
import { PARTY_BOARD_KIND } from "../../party-board/logic";
import { pauseOf } from "../../pause/logic";
import { STATS_WINDOW_KIND } from "../../stats/logic";
import { statsViews, viewKey } from "../../stats/view";
import { PREFS_KIND } from "../PreferencesWindow";
import { togglePalette } from "./state";
import type { CommandCtx, PaletteCommand, When } from "./types";

/** SP2's Rules window (FR-CMP-63): its key is live once the kind registers. */
export const RULES_KIND = "cmp.rules";

export const NOT_CONNECTED = "Not connected";
export const NO_FIGHT = "No fight started";

/** Commands that send: disabled unless `live` (FR-SHELL-186). */
const sending = (ctx: CommandCtx): When => (ctx.live ? true : NOT_CONNECTED);

/** The roll bar's expression field (FR-DICE-21). */
const ROLL_FIELD = '[data-testid="dice-roll-expression"]';

/**
 * Focus `selector` once it is on screen (the window may still be opening), for up to 1 s. Runs
 * after the palette's own focus return, so it wins.
 */
export function focusWhenReady(selector: string, timeoutMs = 1000): void {
  if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return;
  const t0 = performance.now();
  const tick = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && el.getClientRects().length > 0) {
      el.focus();
      return;
    }
    if (performance.now() - t0 < timeoutMs) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** A window key (FR-SHELL-189): hidden while the kind isn't registered or not available. */
function windowKey(id: string, kind: string, title: string, key: string): PaletteCommand {
  return {
    id,
    title,
    group: "Windows",
    clients: ["dm", "player"],
    keys: [key],
    window: kind,
    when: (ctx) => ctx.available.has(kind),
    run: (ctx) => ctx.shell.toggleWindow(kind),
  };
}

/** The viewer's own characters (player) / every campaign character (DM), by name. */
export function charactersOf(store: RecordStore): { id: string; name: string }[] {
  const you = store.you;
  return recordsOf<{ id: string; kind: string; name: string; ownerPlayerId?: string | null }>(
    store,
    ENTITY_TYPE,
  )
    .filter(
      (e) => e.kind === "character" && (you?.role !== "player" || e.ownerPlayerId === you.playerId),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The started encounter's turn rows, as the Initiative window sends them (FR-CBT-50). */
function turnStep(store: RecordStore, direction: "next" | "prev") {
  const enc = startedIn(store);
  if (!enc) return null;
  const rows = recordsOf<CombatantView>(store, COMBATANT_TYPE).filter(
    (c) => c.encounterId === enc.id && c.active !== false,
  );
  return {
    payload: {
      encounterId: enc.id,
      expectedRound: enc.round,
      expectedTurnId: enc.turnCombatantId ?? null,
    },
    ...stepSkip(store, rows, enc, direction),
  };
}

function turnCommand(direction: "next" | "prev"): PaletteCommand {
  const name = direction === "next" ? "cbt.nextTurn" : "cbt.prevTurn";
  return {
    id: direction === "next" ? "cbt.next-turn" : "cbt.prev-turn",
    title: direction === "next" ? "Next turn" : "Previous turn",
    keywords: ["initiative", "combat", direction === "next" ? "advance" : "back"],
    group: "Commands",
    clients: ["dm"],
    keys: [direction === "next" ? "N" : "Shift+N"],
    // A paused DM may still step (FR-SHELL-186 test: the pause never holds the DM).
    when: (ctx) => {
      const live = sending(ctx);
      if (live !== true) return live;
      return startedIn(ctx.store) ? true : NO_FIGHT;
    },
    async run(ctx) {
      const step = turnStep(ctx.store, direction);
      if (!step) return;
      const r = await ctx.send<TurnResult>(name, step.payload);
      if (r === undefined) return;
      if (step.skipped) {
        toast(<span data-testid="cbt-init-skipped">{skipText(step.skipped, step.dead)}</span>);
      }
      if (r?.notRestored?.length) {
        toast(<span data-testid="cbtx-not-restored">{notRestoredText(r.notRestored)}</span>);
      }
    },
  };
}

/** The DM's Pause control's trigger (FR-SHELL-129); the command opens its Popover. */
const PAUSE_TRIGGER = '[data-testid="ui-pause-open"]';

/** SP1's lines (appended to `commands.ts` as one list). */
export const SP1_COMMANDS: readonly PaletteCommand[] = [
  {
    id: "shell.palette",
    title: "Search and commands",
    group: "Commands",
    clients: ["dm", "player"],
    keys: ["Mod+K"],
    paletteHidden: true,
    // FR-SHELL-180: the chord toggles.
    run: () => togglePalette(),
  },
  {
    id: "shell.shortcuts",
    title: "Keyboard shortcuts",
    keywords: ["keys", "help", "hotkeys"],
    group: "Commands",
    clients: ["dm", "player"],
    keys: ["?"],
    run: (ctx) => ctx.openShortcuts(),
  },
  {
    id: "shell.roll",
    title: "Roll dice",
    keywords: ["roll bar", "game log", "dice"],
    group: "Commands",
    clients: ["dm", "player"],
    keys: ["/"],
    when: (ctx) => ctx.available.has(DICE_LOG_KIND),
    run(ctx) {
      ctx.shell.openWindow(DICE_LOG_KIND);
      focusWhenReady(ROLL_FIELD);
    },
  },
  {
    id: "shell.reset-layout",
    title: "Reset layout",
    keywords: ["windows", "default"],
    group: "Commands",
    clients: ["dm", "player"],
    run: (ctx) => ctx.shell.resetLayout(),
  },
  {
    id: "shell.preferences",
    title: "Preferences",
    keywords: ["settings", "options"],
    group: "Commands",
    clients: ["dm", "player"],
    run: (ctx) => ctx.shell.openWindow(PREFS_KIND),
  },
  turnCommand("next"),
  turnCommand("prev"),
  {
    id: "shell.pause",
    title: "Pause…",
    keywords: ["break", "pause screen"],
    group: "Commands",
    clients: ["dm"],
    when: (ctx) => (pauseOf(ctx.store) ? false : sending(ctx)),
    run() {
      // The Popover belongs to the top-bar control: the command opens it as a click would.
      document.querySelector<HTMLElement>(PAUSE_TRIGGER)?.click();
    },
  },
  {
    id: "shell.resume",
    title: "Resume",
    keywords: ["pause", "unpause"],
    group: "Commands",
    clients: ["dm"],
    when: (ctx) => (pauseOf(ctx.store) ? sending(ctx) : false),
    run: (ctx) => void ctx.send(RESUME_INTENT, {}),
  },
  {
    id: "stats.awards",
    title: "Show awards",
    keywords: ["stats", "session", "trophies"],
    group: "Commands",
    clients: ["dm"],
    when: (ctx) => ctx.available.has(STATS_WINDOW_KIND),
    run(ctx) {
      // The Session tab, as a click on it; its Show button sends (FR-SHELL-94).
      const you = ctx.store.you;
      statsViews().set(you ? viewKey(you) : null, { tab: "session", sessionFromN: null });
      ctx.shell.openWindow(STATS_WINDOW_KIND);
    },
  },
  // FR-SHELL-189: the window keys (§7 table).
  windowKey("window.log", DICE_LOG_KIND, "Game log", "L"),
  windowKey("window.initiative", INITIATIVE_KIND, "Initiative", "I"),
  windowKey("window.tray", DICEX_TRAY_KIND, "Dice tray", "D"),
  {
    id: "window.sheet",
    title: "Character sheet",
    group: "Windows",
    clients: ["dm", "player"],
    keys: ["C"],
    window: CHAR_SHEET_KIND,
    when: (ctx) => ctx.available.has(CHAR_SHEET_KIND),
    run(ctx) {
      // Your one character's sheet; several (or the DM) → the palette on `@`.
      const mine = ctx.client === "player" ? charactersOf(ctx.store) : [];
      const only = mine.length === 1 ? mine[0] : undefined;
      if (!only) {
        ctx.openPalette("@");
        return;
      }
      openSheetFor(only.id, "character");
      ctx.shell.toggleWindow(CHAR_SHEET_KIND);
    },
  },
  windowKey("window.compendium", CMP_KIND, "Compendium", "B"),
  windowKey("window.rules", RULES_KIND, "Rules", "R"),
  windowKey("window.party", PARTY_BOARD_KIND, "Party Manager", "P"),
  windowKey("window.stats", STATS_WINDOW_KIND, "Stats", "S"),
];
