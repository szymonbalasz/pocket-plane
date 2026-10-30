// The look shared by DropdownMenu (menus.tsx) and ContextMenu (context-menu.tsx).
import { POPOVER_LAYER } from "./layers";

export const menuSurface = `${POPOVER_LAYER} min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md`;
export const menuItem =
  "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";
