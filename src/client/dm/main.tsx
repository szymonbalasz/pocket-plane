import "@ui/styles.css";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { ShellToaster } from "@ui/features/play-shell/ShellToaster";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <TooltipProvider delayDuration={200}>
      <App />
      {/* FR-SHELL-01: the DM's one toast region, top-centre below the top bar (#153). */}
      <ShellToaster client="dm" />
    </TooltipProvider>
  </StrictMode>,
);
