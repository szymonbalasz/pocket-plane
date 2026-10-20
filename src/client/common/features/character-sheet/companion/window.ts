// `charx.companion` window geometry (FR-CHARX-59, FR-SHELL-61 (5), seams S3; protocol §18 / §24
// rows); each client registers its own def (player: launcher "Companions", DM: none).
import type { WindowDef } from "../../play-shell/registry";

/** Same string as combat's request helper (`COMPANION_CARD_KIND`, FR-CBT-119). */
export const COMPANION_KIND = "charx.companion";

export const companionWindowBase = {
  kind: COMPANION_KIND,
  title: "Companion",
  defaultSize: { w: 320, h: 360 },
  minSize: { w: 280, h: 240 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultOpen: false,
} satisfies Partial<WindowDef>;
