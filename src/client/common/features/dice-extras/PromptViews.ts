// The roll-request prompt's notification views (FR-NOTE-59, -61), both clients' registries. The
// bodies (`PromptBody.tsx`: Roll + Decline, outcomes) are a small lazy chunk the dice runtime
// preloads at idle after the first snapshot (DICEX §12 initial budget); until it is in, a row
// shows its text.
import { ROLL_REQUEST_KIND } from "@shared/dice-extras/request-names";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { DicesIcon } from "lucide-react";
import { createElement, lazy, Suspense } from "react";
import { defineNotificationView, type NotificationView } from "../notifications/views";
import { createChunkLoader } from "./lazy3d";

/** The prompt bodies' chunk (`DiceExtrasRuntime` loads it at idle). */
export const promptChunk = createChunkLoader(() => import("./PromptBody"));

const Player = lazy(() => import("./PromptBody").then((m) => ({ default: m.PlayerPrompt })));
const Dm = lazy(() => import("./PromptBody").then((m) => ({ default: m.DmPrompt })));

type Body = typeof Player;
const withText = (Inner: Body) =>
  function PromptRow({ notification: n }: { notification: NotificationRecord }) {
    return createElement(
      Suspense,
      { fallback: createElement("span", null, n.text) },
      createElement(Inner, { notification: n }),
    );
  };

/** FR-NOTE-59: the player's prompt (Roll + Decline in the toast and the history row). */
export const rollRequestPlayerView: NotificationView = defineNotificationView({
  kind: ROLL_REQUEST_KIND,
  icon: DicesIcon,
  render: withText(Player),
  // FR-DICEX-91, FR-NOTE-60: open prompts re-toast silently after a reload / reconnect.
  restoreToast: true,
});

/** FR-NOTE-61: the DM's row "‹PC› · ‹label›"; no toast, no cue, no action. */
export const rollRequestDmView: NotificationView = defineNotificationView({
  kind: ROLL_REQUEST_KIND,
  icon: DicesIcon,
  render: withText(Dm),
  cueTokens: () => [],
});
