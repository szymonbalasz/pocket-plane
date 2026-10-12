import "@ui/styles.css";
import { TooltipProvider } from "@ui/components/ui/overlays";
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
      <Toaster theme="dark" position="bottom-right" />
    </TooltipProvider>
  </StrictMode>,
);
