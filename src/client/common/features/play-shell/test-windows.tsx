// Window types the shell registers for both clients, test mode only (FR-SHELL-20/21).
// Test mode = the snapshot carries the `probe` type, the same signal as live-sync's probe panel
// (FR-SYNC-27).
import type { RecordStore } from "@shared/protocol/store";
import { FlaskConicalIcon, TestTubeIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/primitives";
import { ProbePanel } from "../live-sync/ProbePanel";
import { defineWindow, type WindowProps } from "./registry";
import { useShellAlert } from "./ShellContext";

export const SHELL_TEST_KIND = "shell.test";
export const SHELL_TEST_DRAG_MIME = "application/x-pp-shell-test";

export const isTestMode = (store: RecordStore) => store.records.probe !== undefined;

/** Strips the card chrome of a panel rendered inside a window body. */
const UNCARD = "[&>div]:border-0 [&>div]:bg-transparent [&>div]:shadow-none";

function ShellTestBody({ kind, instance }: WindowProps) {
  const [text, setText] = useState("");
  const alert = useShellAlert();
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        Window key: <code data-testid="shell-test-key">{`${kind}:${instance}`}</code>
      </p>
      <Input
        data-testid="shell-test-input"
        aria-label="Test input"
        placeholder="Type here"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: test-only HTML5 drag source, no click action */}
      <div
        data-testid="shell-test-drag"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(SHELL_TEST_DRAG_MIME, `${kind}:${instance}`);
          e.dataTransfer.effectAllowed = "copy";
        }}
        className="w-fit cursor-grab rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground"
      >
        Drag me onto the map
      </div>
      {/* FR-SHELL-27: fires the same alert a feature would (flash, Toast, ping). */}
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        data-testid="shell-test-alert"
        onClick={() => alert({ id: SHELL_TEST_KIND, title: "Test alert", sound: "ping" })}
      >
        Alert
      </Button>
    </div>
  );
}

export const shellTestWindow = defineWindow({
  kind: SHELL_TEST_KIND,
  title: "Shell test",
  clients: ["dm", "player"],
  defaultSize: { w: 320, h: 220 },
  minSize: { w: 240, h: 160 },
  // Bottom-right, lifted clear of the player toast stack (above the launcher strip).
  defaultPosition: { anchor: "bottom-right", dy: 150 },
  fixedDefault: true,
  launcher: { icon: TestTubeIcon, label: "Test", order: 910 },
  available: isTestMode,
  component: ShellTestBody,
});

function ProbesBody() {
  return (
    <div className={UNCARD}>
      <ProbePanel />
    </div>
  );
}

export const syncProbesWindow = defineWindow({
  kind: "sync.probes",
  title: "Sync probes",
  clients: ["dm", "player"],
  defaultSize: { w: 560, h: 360 },
  minSize: { w: 320, h: 180 },
  // Bottom-left: a fixed spot walkthroughs rely on (may cover the game log; test mode only).
  defaultPosition: { anchor: "bottom-left" },
  fixedDefault: true,
  launcher: { icon: FlaskConicalIcon, label: "Probes", order: 900 },
  available: isTestMode,
  component: ProbesBody,
});

export { UNCARD };
