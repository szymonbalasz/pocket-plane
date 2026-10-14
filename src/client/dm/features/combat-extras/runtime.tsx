// DM combat-extras runtime, mounted by `cbt.initiative`'s companion (always available on the DM
// client): the dialogs, the concentration roll host (FR-CBTX-37) and the expiry Toast
// (FR-CBTX-06, from live event frames only).
import { ConcentrationRollHost } from "@ui/features/combat-extras/concentration";
import { useEventFrame } from "@ui/sync/store";
import { toast } from "sonner";
import { CbtxDialogs } from "./dialogs";
import { expiredToastText } from "./expired";

function ExpiredToastRuntime() {
  useEventFrame((frame, store) => {
    const text = expiredToastText(frame, store);
    if (text) toast(<span data-testid="cbtx-expired-toast">{text}</span>);
  });
  return null;
}

export function CbtxRuntime() {
  return (
    <>
      <CbtxDialogs />
      <ConcentrationRollHost />
      <ExpiredToastRuntime />
    </>
  );
}
