// Stacking of the body portals (play-shell `PlayFrame`), bottom → top: dialogs (z-50) < the alert
// flash (z-100) < the toast stack (`TOAST_STACK_Z` 900) < **popovers** (Popover, DropdownMenu,
// Select lists, Tooltips: this layer) < the overlay layer (`OVERLAY_LAYER_Z` 1000: palette, pause
// card) < the present popup < the dice layer. An open list or menu is the thing the pointer is
// on, so no toast may cover it (K10 walkthrough side finding); dialogs stay under the toasts, so
// an error stays readable over one (FR-NOTE-50).

/** The popover layer's z-index. */
export const POPOVER_Z = 950;

/** Its Tailwind class (a literal, so Tailwind generates it); equals `POPOVER_Z`. */
export const POPOVER_LAYER = "z-[950]";
