import "@ui/styles.css";
import {
  TOOLTIP_DELAY_MS,
  TOOLTIP_SKIP_DELAY_MS,
  TooltipProvider,
} from "@ui/components/ui/overlays";
import { ShellToaster } from "@ui/features/play-shell/ShellToaster";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS} skipDelayDuration={TOOLTIP_SKIP_DELAY_MS}>
      <App />
      {/* FR-SHELL-01: the player's one toast region, bottom-right. */}
      <ShellToaster client="player" />
    </TooltipProvider>
  </StrictMode>,
);
