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
import { DmAttachUploaderProvider } from "./features/assets-pipeline/uploader";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS} skipDelayDuration={TOOLTIP_SKIP_DELAY_MS}>
      {/* FR-ASSET-27: uploads (picker, attach control) only in the DM client. */}
      <DmAttachUploaderProvider>
        <App />
      </DmAttachUploaderProvider>
      {/* FR-SHELL-01: the DM's one toast region, top-centre below the top bar (#153). */}
      <ShellToaster client="dm" />
    </TooltipProvider>
  </StrictMode>,
);
