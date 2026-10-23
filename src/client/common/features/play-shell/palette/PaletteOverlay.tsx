// The palette overlay (FR-SHELL-180, -181, -190; overlays.ts entry `palette`, layer 5 below the
// pause card, `blocksInput: false`): mounts the one shortcut dispatcher (no frame edit) and draws
// the palette and the shortcuts sheet when open. Never placed, no keep-out, no layout entry.
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { blockingOverlay, OVERLAYS, overlaysFor } from "../overlays";
import { useAvailableKinds } from "../ShellContext";
import { SHELL_TEST_KIND } from "../test-windows";
import { isMac, type PaletteEnv, usePaletteEnv } from "./context";
import { decide, modalDialogOpen } from "./dispatch";
import { Palette } from "./Palette";
import { whenOf } from "./rank";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { closePalette, closeShortcuts, paletteUi } from "./state";
import { keysSetting } from "./storage";

const TEST_ATTR = "data-test-last-shortcut";

/** A `blocksInput` overlay of this client is up now (FR-SHELL-128). */
const isBlocked = (env: PaletteEnv): boolean =>
  blockingOverlay(overlaysFor(env.ctx.client, OVERLAYS), env.ctx.store) !== null;

export function PaletteOverlay() {
  const env = usePaletteEnv();
  const blocked = isBlocked(env);
  const testMode = useAvailableKinds().has(SHELL_TEST_KIND);
  const open = useStore(paletteUi, (s) => s.open);
  const sheet = useStore(paletteUi, (s) => s.sheet);
  const latest = useRef({ env, blocked, testMode });
  latest.current = { env, blocked, testMode };

  // Nothing of the palette stays over the pause card (it opens again after Resume).
  useEffect(() => {
    if (blocked) {
      closePalette();
      closeShortcuts();
    }
  }, [blocked]);

  // FR-SHELL-190: one capture-phase listener on `window`, registered once (before any pause
  // guard, so a blocked key is still recorded); it reads the page through `latest`.
  useEffect(() => {
    const mac = isMac();
    const onKey = (e: KeyboardEvent) => {
      const { env, blocked, testMode } = latest.current;
      const d = decide(e, {
        commands: env.commands,
        mac,
        blocked,
        modalOpen: modalDialogOpen(document),
        singleKey: keysSetting.getState().singleKey,
        when: (c) => whenOf(c, env.ctx),
      });
      if (!d) return;
      if (testMode) document.body.setAttribute(TEST_ATTR, `${d.command.id}:${d.outcome}`);
      if (d.outcome !== "ran") return;
      e.preventDefault();
      void d.command.run(env.ctx);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      document.body.removeAttribute(TEST_ATTR);
    };
  }, []);

  return (
    <>
      {open && <Palette env={env} />}
      {sheet && <ShortcutsSheet env={env} mac={isMac()} />}
    </>
  );
}
