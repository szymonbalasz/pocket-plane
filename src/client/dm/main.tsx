import "@ui/styles.css";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { EDGE_GAP, TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <TooltipProvider delayDuration={200}>
      <App />
      {/* FR-SHELL-01: the DM's one toast region, top-centre below the top bar (#153). */}
      <Toaster theme="dark" position="top-center" offset={{ top: TOP_BAR_H + EDGE_GAP }} />
    </TooltipProvider>
  </StrictMode>,
);
