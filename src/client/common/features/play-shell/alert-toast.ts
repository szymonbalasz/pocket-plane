// Alert Toasts go to the client's one Toaster (ShellToaster), in its toast region (FR-SHELL-01).
import { toast } from "sonner";
import { alertText, type ShellAlert } from "./alerts";

/** Same surface as the notification toasts (`note-toast`), not sonner's own dark style. */
const ALERT_TOAST_CLASS =
  "flex w-[var(--width)] items-center gap-2 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg";

/** Toast "‹title› — ‹detail›" (FR-SHELL-22); a repeat of the same id replaces its toast. */
export function showAlertToast(a: ShellAlert): void {
  toast(alertText(a), {
    id: `alert:${a.id}`,
    testId: "ui-alert-toast",
    unstyled: true,
    className: ALERT_TOAST_CLASS,
  });
}
